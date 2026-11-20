
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.SOCIALDATA_API_KEY;
    const backupApiKey = process.env.TWITTERAPIS_API_KEY;
    const xdataApiKey = process.env.XDATAAPI_API_KEY;
    const getxApiKey = process.env.GETXAPI_API_KEY;

    const query = req.query.q ||
        '(memecoin OR "meme coin" OR pump.fun OR solana OR degen)';

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    const PAGE_SIZE = 500;
    const CACHE_TTL = 300;
    const ERROR_CACHE_TTL = 300;
    const REFRESH_LOCK_SECONDS = 310;

    // Versi cache baru agar tidak memakai cache format lama.
    const cacheKey = "latest_feed_v2:" + query;

    // ==========================================
    // MONITORING
    // ==========================================

    const monitorEvents = [];

    const providerRoles = {
        SocialData: "primary",
        TwitterAPIs: "backup 1",
        XDataAPI: "backup 2",
        GetXAPI: "backup 3"
    };

    const providerRequestCounts = {
        SocialData: 0,
        TwitterAPIs: 0,
        XDataAPI: 0,
        GetXAPI: 0
    };

    function addMonitorEvent(provider, status, action, error = null) {
        monitorEvents.push({
            module: "latest",
            provider,
            role: providerRoles[provider],
            status,
            action,
            requests_count: Math.max(
                1,
                providerRequestCounts[provider] || 1
            ),
            error_message: error
                ? String(error).slice(0, 2000)
                : null,
            created_at: new Date().toISOString()
        });
    }

    async function flushMonitoring() {
        if (
            !supabaseUrl ||
            !supabaseKey ||
            monitorEvents.length === 0
        ) {
            return;
        }

        const baseUrl = supabaseUrl.replace(/\/$/, "");

        const headers = {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
        };

        const latestByProvider = new Map();

        for (const event of monitorEvents) {
            latestByProvider.set(event.provider, event);
        }

        const logs = monitorEvents.map(event => ({
            module: event.module,
            provider: event.provider,
            action: event.action,
            status: event.status,
            requests_count: event.requests_count,
            error_message: event.error_message,
            created_at: event.created_at
        }));

        const providerUpdates = Array.from(
            latestByProvider.values()
        ).map(event => ({
            module: "latest",
            provider: event.provider,
            role: event.role,
            status: event.status === "success" ? "active" : "error",
            last_checked_at: event.created_at,
            last_used_at: event.created_at,
            last_error: event.error_message
        }));

        try {
            const results = await Promise.all([
                fetch(`${baseUrl}/rest/v1/api_usage_logs`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(logs)
                }),

                fetch(
                    `${baseUrl}/rest/v1/api_provider_status?on_conflict=module,provider`,
                    {
                        method: "POST",
                        headers: {
                            ...headers,
                            Prefer: "resolution=merge-duplicates,return=minimal"
                        },
                        body: JSON.stringify(providerUpdates)
                    }
                )
            ]);

            if (!results[0].ok) {
                console.error(
                    "Latest monitoring logs failed:",
                    await results[0].text()
                );
            }

            if (!results[1].ok) {
                console.error(
                    "Latest provider status failed:",
                    await results[1].text()
                );
            }
        } catch (error) {
            console.error("Latest monitoring error:", error.message);
        }
    }

    // ==========================================
    // CACHE
    // ==========================================

    async function readFeedCache() {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase cache credentials missing");
        }

        const response = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/latest_feed_cache?select=cache_data,expires_at&cache_key=eq.${encodeURIComponent(cacheKey)}&limit=1`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                "Cache read failed: " + await response.text()
            );
        }

        const rows = await response.json();
        return rows.length ? rows[0] : null;
    }

    async function claimFeedRefresh() {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase lock credentials missing");
        }

        const response = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/claim_latest_feed_refresh`,
            {
                method: "POST",
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    p_cache_key: cacheKey,
                    p_lock_seconds: REFRESH_LOCK_SECONDS
                })
            }
        );

        if (!response.ok) {
            throw new Error(
                "Refresh lock failed: " + await response.text()
            );
        }

        return await response.json() === true;
    }

    async function saveFeedCache(payload, ttl = CACHE_TTL) {
        if (!supabaseUrl || !supabaseKey) {
            return false;
        }

        try {
            const expiresAt = new Date(
                Date.now() + ttl * 1000
            ).toISOString();

            const response = await fetch(
                `${supabaseUrl.replace(/\/$/, "")}/rest/v1/latest_feed_cache?on_conflict=cache_key`,
                {
                    method: "POST",
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`,
                        "Content-Type": "application/json",
                        Prefer: "resolution=merge-duplicates,return=minimal"
                    },
                    body: JSON.stringify({
                        cache_key: cacheKey,
                        cache_data: { payload },
                        expires_at: expiresAt,
                        updated_at: new Date().toISOString()
                    })
                }
            );

            if (!response.ok) {
                console.error(
                    "Cache save failed:",
                    await response.text()
                );
                return false;
            }

            return true;
        } catch (error) {
            console.error("Cache save error:", error.message);
            return false;
        }
    }

    async function sendResponse(status, payload) {
        if (status === 200 && payload.success === true) {
            const ttl = payload.warning
                ? ERROR_CACHE_TTL
                : CACHE_TTL;

            await saveFeedCache(payload, ttl);
        }

        await flushMonitoring();
        return res.status(status).json(payload);
    }

    // ==========================================
    // FILTER POSTINGAN
    // ==========================================

    function isRelevant(tweet) {
        const text = (tweet.full_text || "").toLowerCase();

        const keywords = [
            "memecoin", "meme coin", "meme", "pump.fun",
            "pumpfun", "solana", "token", "coin", "crypto",
            "dex", "bonding curve", "market cap", "pump",
            "degen", "launch", "ca:", "rug", "liquidity",
            "holder", "trading", "alpha", "new coin",
            "new token"
        ];

        return keywords.some(keyword => text.includes(keyword));
    }

    // ==========================================
    // HAPUS DUPLIKAT BERDASARKAN ID
    // ==========================================

    function removeDuplicates(tweets) {
        const unique = new Map();

        for (const tweet of tweets) {
            if (!tweet.id) continue;
            unique.set(String(tweet.id), tweet);
        }

        return Array.from(unique.values());
    }

    // ==========================================
    // PENGURUTAN
    // ==========================================

    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA =
                new Date(a.created_at || 0).getTime() || 0;

            const dateB =
                new Date(b.created_at || 0).getTime() || 0;

            if (dateA !== dateB) {
                return dateB - dateA;
            }

            return String(b.id || "").localeCompare(
                String(a.id || "")
            );
        });
    }

    // ==========================================
    // GABUNGKAN ARSIP DAN POSTINGAN BARU
    // Arsip lama selalu diprioritaskan.
    // ==========================================

    function mergeTweets(archivedTweets, newTweets) {
        const combined = new Map();

        for (const tweet of archivedTweets) {
            if (tweet.id) {
                combined.set(String(tweet.id), tweet);
            }
        }

        for (const tweet of newTweets) {
            const id = String(tweet.id || "");

            if (id && !combined.has(id)) {
                combined.set(id, tweet);
            }
        }

        return sortTweets(Array.from(combined.values()));
    }

    // ==========================================
    // PAGINASI ARSIP SUPABASE
    // ==========================================

    async function getArchivedPage(beforeCreatedAt = null, beforeId = null) {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase archive credentials missing");
        }

        const params = new URLSearchParams({
            select: "id,full_text,created_at,user,entities",
            order: "created_at.desc,id.desc",
            limit: String(PAGE_SIZE + 1)
        });

        if (beforeCreatedAt && beforeId) {
            const cursorFilter =
                `created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`;

            params.set("or", `(${cursorFilter})`);
        }

        const response = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/latest_x_posts?${params.toString()}`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                "Archive read error: " + await response.text()
            );
        }

        const rows = await response.json();

        const hasMore = rows.length > PAGE_SIZE;
        const pageTweets = rows.slice(0, PAGE_SIZE);

        const lastTweet = pageTweets[pageTweets.length - 1];

        return {
            tweets: pageTweets,
            hasMore,
            nextCursor: hasMore && lastTweet
                ? {
                    created_at: lastTweet.created_at,
                    id: String(lastTweet.id)
                }
                : null
        };
    }

    async function buildArchivedResponse(newTweets) {
        const archiveSaved =
            await saveTweetsToSupabase(newTweets);

        const archivePage =
            await getArchivedPage();

        const combinedTweets =
            mergeTweets(archivePage.tweets, newTweets);

        const pageTweets =
            combinedTweets.slice(0, PAGE_SIZE);

        const hasMore =
            combinedTweets.length > PAGE_SIZE ||
            archivePage.hasMore;

        const lastTweet =
            pageTweets[pageTweets.length - 1];

        return {
            archiveSaved,
            tweets: pageTweets,
            hasMore,
            nextCursor: hasMore && lastTweet
                ? {
                    created_at: lastTweet.created_at,
                    id: String(lastTweet.id)
                }
                : null
        };
    }

    // ==========================================
    // SIMPAN ARSIP TANPA MENIMPA ID LAMA
    // ==========================================

    async function saveTweetsToSupabase(tweets) {
        if (!supabaseUrl || !supabaseKey) {
            console.error("Supabase credentials missing");
            return false;
        }

        const validTweets = tweets.filter(tweet => tweet.id);

        if (!validTweets.length) {
            return true;
        }

        const records = validTweets.map(tweet => ({
            id: String(tweet.id),
            full_text: tweet.full_text || "",
            created_at: tweet.created_at || null,
            user: tweet.user || {},
            entities: tweet.entities || []
        }));

        try {
            const response = await fetch(
                `${supabaseUrl.replace(/\/$/, "")}/rest/v1/latest_x_posts?on_conflict=id`,
                {
                    method: "POST",
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`,
                        "Content-Type": "application/json",
                        Prefer: "resolution=ignore-duplicates,return=minimal"
                    },
                    body: JSON.stringify(records)
                }
            );

            if (!response.ok) {
                console.error(
                    "Supabase archive error:",
                    await response.text()
                );
                return false;
            }

            return true;
        } catch (error) {
            console.error("Supabase save error:", error);
            return false;
        }
    }

    // ==========================================
    // HALAMAN ARSIP SELANJUTNYA
    // Hanya membaca Supabase, tidak memanggil API X.
    // ==========================================

    const beforeCreatedAt = req.query.before_created_at;
    const beforeId = req.query.before_id;

    if (beforeCreatedAt || beforeId) {
        if (!beforeCreatedAt || !beforeId) {
            return res.status(400).json({
                success: false,
                error: "Cursor tidak lengkap"
            });
        }

        try {
            const page = await getArchivedPage(
                beforeCreatedAt,
                beforeId
            );

            return res.status(200).json({
                success: true,
                source: "Supabase Archive",
                pageSize: PAGE_SIZE,
                total: page.tweets.length,
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
                tweets: page.tweets
            });
        } catch (error) {
            console.error("Archive pagination error:", error.message);

            return res.status(500).json({
                success: false,
                error: "Gagal mengambil halaman arsip"
            });
        }
    }

    // ==========================================
    // TWITTERAPIS - BACKUP 1
    // ==========================================

    function mapTwitterAPIsTweet(tweet) {
        const media = tweet.media || [];

        return {
            id: tweet.id,
            full_text: tweet.text || "",
            created_at: tweet.created_at || "",
            user: {
                name: tweet.author?.name || "X User",
                username: tweet.author?.username || "",
                profile_image_url:
                    tweet.author?.profile_image_url || ""
            },
            entities: media.map(item => ({
                type: item.type || "photo",
                link:
                    item.media_url_https ||
                    item.media_url ||
                    "",
                preview:
                    item.media_url_https ||
                    item.media_url ||
                    ""
            }))
        };
    }

    async function fetchTwitterAPIs() {
        if (!backupApiKey) {
            throw new Error("TWITTERAPIS_API_KEY belum dipasang");
        }

        let rawTweets = [];
        let cursor = "";

        for (let page = 0; page < 2; page++) {
            const params = new URLSearchParams({
                query: query.replace(/^\(|\)$/g, ""),
                product: "Latest",
                compact: "1",
                fields:
                    "author.profile_image_url,media.media_url_https,media.type"
            });

            if (cursor) params.set("cursor", cursor);

            providerRequestCounts.TwitterAPIs++;

            const response = await fetch(
                "https://api.twitterapis.com/twitter/tweet/advanced_search?" +
                params.toString(),
                {
                    headers: {
                        Authorization: `Bearer ${backupApiKey}`,
                        Accept: "application/json"
                    }
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message || data.error || "TwitterAPIs gagal"
                );
            }

            rawTweets.push(...(data.tweets || []));
            cursor = data.next_cursor || "";

            if (!cursor || !data.tweets?.length) break;
        }

        return rawTweets.map(mapTwitterAPIsTweet);
    }

    // ==========================================
    // XDATAAPI - BACKUP 2
    // ==========================================

    function mapXDataTweet(tweet) {
        const author = tweet.author || {};
        const media = Array.isArray(tweet.media) ? tweet.media : [];

        return {
            id: tweet.id,
            full_text: tweet.text || "",
            created_at: tweet.created_at || "",
            user: {
                name: author.name || "X User",
                username: author.handle || "",
                profile_image_url: author.avatar_url || ""
            },
            entities: media.map(item => ({
                type: item.type || "photo",
                link: item.url || "",
                preview: item.url || ""
            }))
        };
    }

    async function fetchXDataAPI() {
        if (!xdataApiKey) {
            throw new Error("XDATAAPI_API_KEY belum dipasang");
        }

        const params = new URLSearchParams({
            q: query,
            product: "Latest",
            count: "20"
        });

        providerRequestCounts.XDataAPI++;

        const response = await fetch(
            "https://api.xdataapi.io/v1/tweets/search?" +
            params.toString(),
            {
                method: "GET",
                headers: {
                    "x-api-key": xdataApiKey,
                    Accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error?.message ||
                data.message ||
                `XDataAPI gagal: HTTP ${response.status}`
            );
        }

        if (!Array.isArray(data.data)) {
            throw new Error("Format respons XDataAPI tidak dikenali");
        }

        return data.data.map(mapXDataTweet);
    }

    // ==========================================
    // GETXAPI - BACKUP 3
    // ==========================================

    function mapGetXAPITweet(tweet) {
        const author = tweet.author || {};
        const media = Array.isArray(tweet.media) ? tweet.media : [];

        return {
            id: String(tweet.id || ""),
            full_text: tweet.text || "",
            created_at: tweet.createdAt || "",
            user: {
                name: author.name || "X User",
                username: author.userName || "",
                profile_image_url: author.profilePicture || ""
            },
            entities: media.map(item => {
                const mediaUrl = typeof item === "string"
                    ? item
                    : (
                        item.url ||
                        item.media_url ||
                        item.media_url_https ||
                        item.image_url ||
                        item.preview_image_url ||
                        ""
                    );

                return {
                    type: typeof item === "object"
                        ? (item.type || "photo")
                        : "photo",
                    link: mediaUrl,
                    preview: mediaUrl
                };
            }).filter(item => item.link)
        };
    }

    async function fetchGetXAPI() {
        if (!getxApiKey) {
            throw new Error("GETXAPI_API_KEY belum dipasang");
        }

        const params = new URLSearchParams({
            q: query,
            product: "Latest"
        });

        providerRequestCounts.GetXAPI++;

        const response = await fetch(
            "https://api.getxapi.com/twitter/tweet/advanced_search?" +
            params.toString(),
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${getxApiKey}`,
                    Accept: "application/json"
                }
            }
        );

        const responseText = await response.text();

        let data;

        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error(
                `GetXAPI memberikan respons bukan JSON: HTTP ${response.status}`
            );
        }

        if (!response.ok) {
            throw new Error(
                data.message ||
                data.error ||
                `GetXAPI gagal: HTTP ${response.status}`
            );
        }

        if (!Array.isArray(data.tweets)) {
            throw new Error("Format respons GetXAPI tidak dikenali");
        }

        return data.tweets.map(mapGetXAPITweet);
    }

    // ==========================================
    // BACKUP BERURUTAN
    // ==========================================

    async function tryFallbackProviders() {
        const errors = [];

        const providers = [
            { name: "TwitterAPIs", fetch: fetchTwitterAPIs },
            { name: "XDataAPI", fetch: fetchXDataAPI },
            { name: "GetXAPI", fetch: fetchGetXAPI }
        ];

        for (const provider of providers) {
            try {
                console.log("Trying backup:", provider.name);

                const rawTweets = await provider.fetch();
                const relevantTweets = rawTweets.filter(isRelevant);
                const uniqueTweets = removeDuplicates(relevantTweets);

                if (!uniqueTweets.length) {
                    addMonitorEvent(
                        provider.name,
                        "success",
                        "search_no_relevant_results"
                    );

                    errors.push(
                        `${provider.name}: tidak ada postingan relevan`
                    );
                    continue;
                }

                sortTweets(uniqueTweets);

                const result =
                    await buildArchivedResponse(uniqueTweets);

                addMonitorEvent(
                    provider.name,
                    "success",
                    "search"
                );

                return {
                    provider: provider.name,
                    ...result,
                    errors
                };
            } catch (error) {
                addMonitorEvent(
                    provider.name,
                    "failed",
                    "search",
                    error.message
                );

                console.log(
                    `${provider.name} failed:`,
                    error.message
                );

                errors.push(`${provider.name}: ${error.message}`);
            }
        }

        return { provider: null, errors };
    }

    function sendFallbackResponse(result) {
        return sendResponse(200, {
            success: true,
            activeSources: [result.provider],
            backupSources: Object.keys(providerRoles).filter(
                name => name !== result.provider
            ),
            total: result.tweets.length,
            pageSize: PAGE_SIZE,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            archiveSaved: result.archiveSaved,
            tweets: result.tweets
        });
    }

    // ==========================================
    // CACHE CHECK + REFRESH LOCK
    // ==========================================

    let cacheSnapshot = null;

    try {
        cacheSnapshot = await readFeedCache();

        const cachedPayload =
            cacheSnapshot?.cache_data?.payload;

        const cacheExpiry = cacheSnapshot?.expires_at
            ? new Date(cacheSnapshot.expires_at).getTime()
            : 0;

        if (cachedPayload && cacheExpiry > Date.now()) {
            return res.status(200).json(cachedPayload);
        }

        const refreshClaimed = await claimFeedRefresh();

        if (!refreshClaimed) {
            if (cachedPayload) {
                return res.status(200).json(cachedPayload);
            }

            const archive = await buildArchivedResponse([]);

            return res.status(200).json({
                success: true,
                activeSources: [],
                backupSources: Object.keys(providerRoles),
                total: archive.tweets.length,
                pageSize: PAGE_SIZE,
                hasMore: archive.hasMore,
                nextCursor: archive.nextCursor,
                archiveSaved: true,
                warning: "Refresh sedang berlangsung. Menampilkan arsip tersimpan.",
                tweets: archive.tweets
            });
        }
    } catch (error) {
        console.error("Feed cache error:", error.message);

        const stalePayload =
            cacheSnapshot?.cache_data?.payload;

        if (stalePayload) {
            return res.status(200).json(stalePayload);
        }

        try {
            const archive = await buildArchivedResponse([]);

            return res.status(200).json({
                success: true,
                activeSources: [],
                backupSources: Object.keys(providerRoles),
                total: archive.tweets.length,
                pageSize: PAGE_SIZE,
                hasMore: archive.hasMore,
                nextCursor: archive.nextCursor,
                archiveSaved: true,
                warning: "Cache tidak dapat diakses. Menampilkan arsip tersimpan.",
                tweets: archive.tweets
            });
        } catch (archiveError) {
            console.error("Archive fallback error:", archiveError.message);

            return res.status(500).json({
                success: false,
                error: "Cache dan arsip tidak dapat diakses."
            });
        }
    }

    // ==========================================
    // PROSES UTAMA - SOCIALDATA
    // ==========================================

    let socialDataRecorded = false;

    try {
        if (!apiKey) {
            throw new Error("SOCIALDATA_API_KEY belum dipasang");
        }

        let rawTweets = [];
        let cursor = "";

        for (let page = 0; page < 2; page++) {
            const params = new URLSearchParams({
                query,
                type: "Latest"
            });

            if (cursor) params.set("cursor", cursor);

            providerRequestCounts.SocialData++;

            const response = await fetch(
                "https://api.socialdata.tools/twitter/search?" +
                params.toString(),
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        Accept: "application/json"
                    }
                }
            );

            const responseText = await response.text();

            if (!response.ok) {
                throw new Error(
                    `SocialData HTTP ${response.status}: ${responseText}`
                );
            }

            const data = JSON.parse(responseText);
            const pageTweets = data.tweets || [];

            rawTweets.push(...pageTweets);
            cursor = data.next_cursor || "";

            if (!cursor || pageTweets.length === 0) break;
        }

        const tweets = rawTweets.map(tweet => {
            const media = [
                ...(tweet.extended_entities?.media || []),
                ...(tweet.entities?.media || [])
            ];

            return {
                id: tweet.id_str || tweet.id,
                full_text: tweet.full_text || tweet.text || "",
                created_at:
                    tweet.tweet_created_at ||
                    tweet.created_at ||
                    "",
                user: {
                    name: tweet.user?.name || "X User",
                    username: tweet.user?.screen_name || "",
                    profile_image_url:
                        tweet.user?.profile_image_url_https || ""
                },
                entities: media.map(item => ({
                    type: item.type || "photo",
                    link:
                        item.media_url_https ||
                        item.media_url ||
                        item.expanded_url ||
                        "",
                    preview:
                        item.media_url_https ||
                        item.media_url ||
                        ""
                }))
            };
        });

        const relevantTweets = tweets.filter(isRelevant);
        const uniqueTweets = removeDuplicates(relevantTweets);

        if (uniqueTweets.length > 0) {
            sortTweets(uniqueTweets);

            addMonitorEvent("SocialData", "success", "search");
            socialDataRecorded = true;

            const result =
                await buildArchivedResponse(uniqueTweets);

            return sendResponse(200, {
                success: true,
                activeSources: ["SocialData"],
                backupSources: [
                    "TwitterAPIs",
                    "XDataAPI",
                    "GetXAPI"
                ],
                total: result.tweets.length,
                pageSize: PAGE_SIZE,
                hasMore: result.hasMore,
                nextCursor: result.nextCursor,
                archiveSaved: result.archiveSaved,
                tweets: result.tweets
            });
        }

        addMonitorEvent(
            "SocialData",
            "success",
            "search_no_relevant_results"
        );
        socialDataRecorded = true;

        throw new Error(
            "SocialData tidak menghasilkan postingan relevan"
        );
    } catch (error) {
        if (
            !socialDataRecorded &&
            providerRequestCounts.SocialData > 0
        ) {
            addMonitorEvent(
                "SocialData",
                "failed",
                "search",
                error.message
            );
            socialDataRecorded = true;
        }

        console.log("SocialData failed:", error.message);

        const fallback = await tryFallbackProviders();

        if (fallback.provider) {
            return sendFallbackResponse(fallback);
        }

        try {
            const archive =
                await buildArchivedResponse([]);

            return sendResponse(200, {
                success: true,
                activeSources: [],
                backupSources: [
                    "SocialData",
                    "TwitterAPIs",
                    "XDataAPI",
                    "GetXAPI"
                ],
                total: archive.tweets.length,
                pageSize: PAGE_SIZE,
                hasMore: archive.hasMore,
                nextCursor: archive.nextCursor,
                archiveSaved: archive.archiveSaved,
                warning: "Semua API gagal. Menampilkan arsip tersimpan.",
                errors: [
                    error.message,
                    ...fallback.errors
                ],
                tweets: archive.tweets
            });
        } catch (archiveError) {
            console.error("Archive fallback error:", archiveError.message);

            return sendResponse(500, {
                success: false,
                error: "Semua API gagal dan arsip tidak dapat dibaca."
            });
        }
    }
}
