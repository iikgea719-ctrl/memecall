
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.SOCIALDATA_API_KEY;
    const backupApiKey = process.env.TWITTERAPIS_API_KEY;
    const xdataApiKey = process.env.XDATAAPI_API_KEY;

    const query = req.query.q ||
        '(memecoin OR "meme coin" OR pump.fun OR solana OR degen)';

    // ==========================================
    // MONITORING MEMECALL - LATEST X DISCUSSIONS
    // ==========================================

    const monitorEvents = [];

    const providerRoles = {
        SocialData: "primary",
        TwitterAPIs: "backup 1",
        XDataAPI: "backup 2"
    };

    const providerRequestCounts = {
        SocialData: 0,
        TwitterAPIs: 0,
        XDataAPI: 0
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
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SECRET_KEY;

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
            status: event.status === "success"
                ? "active"
                : "error",
            last_checked_at: event.created_at,
            last_used_at: event.created_at,
            last_error: event.error_message
        }));

        try {
            const results = await Promise.all([
                fetch(
                    `${baseUrl}/rest/v1/api_usage_logs`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify(logs)
                    }
                ),

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
            console.error(
                "Latest monitoring error:",
                error.message
            );
        }
    }

    async function sendResponse(status, payload) {
        await flushMonitoring();
        return res.status(status).json(payload);
    }

    // ==========================================
    // FILTER POSTINGAN RELEVAN
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
    // HAPUS DUPLIKAT HASIL API
    // ==========================================

    function removeDuplicates(tweets) {
        return Array.from(
            new Map(
                tweets.map(tweet => {
                    const normalizedText = (tweet.full_text || "")
                        .toLowerCase()
                        .replace(/https?:\/\/\S+/g, "")
                        .replace(/@\w+/g, "")
                        .replace(/[^a-z0-9]/g, "")
                        .trim();

                    return [
                        normalizedText || tweet.id,
                        tweet
                    ];
                })
            ).values()
        );
    }

    // ==========================================
    // URUTKAN TERBARU DI ATAS
    // ==========================================

    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA =
                new Date(a.created_at || 0).getTime() || 0;

            const dateB =
                new Date(b.created_at || 0).getTime() || 0;

            return dateB - dateA;
        });
    }

    // ==========================================
    // GABUNGKAN ARSIP DAN POSTINGAN BARU
    // ==========================================

    function mergeTweets(archivedTweets, newTweets) {
        const combined = new Map();

        for (const tweet of archivedTweets) {
            if (tweet.id) {
                combined.set(String(tweet.id), tweet);
            }
        }

        for (const tweet of newTweets) {
            if (tweet.id) {
                combined.set(String(tweet.id), tweet);
            }
        }

        return sortTweets(Array.from(combined.values()));
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

            if (cursor) {
                params.set("cursor", cursor);
            }

            providerRequestCounts.TwitterAPIs++;

            const response = await fetch(
                "https://api.twitterapis.com/twitter/tweet/advanced_search?" +
                params.toString(),
                {
                    headers: {
                        "Authorization": `Bearer ${backupApiKey}`,
                        "Accept": "application/json"
                    }
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message ||
                    data.error ||
                    "TwitterAPIs gagal"
                );
            }

            rawTweets.push(...(data.tweets || []));
            cursor = data.next_cursor || "";

            if (!cursor || !data.tweets?.length) {
                break;
            }
        }

        return rawTweets.map(mapTwitterAPIsTweet);
    }

    // ==========================================
    // XDATAAPI - BACKUP 2
    // ==========================================

    function mapXDataTweet(tweet) {
        const author = tweet.author || {};
        const media = Array.isArray(tweet.media)
            ? tweet.media
            : [];

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
                    "Accept": "application/json"
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
    // SUPABASE - PENYIMPANAN ARSIP
    // ==========================================

    async function saveTweetsToSupabase(tweets) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SECRET_KEY;

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
                        Prefer:
                            "resolution=merge-duplicates,return=minimal"
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

    async function getArchivedTweets() {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SECRET_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return [];
        }

        try {
            const response = await fetch(
                `${supabaseUrl.replace(/\/$/, "")}/rest/v1/latest_x_posts?select=id,full_text,created_at,user,entities&order=created_at.desc&limit=1000`,
                {
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`
                    }
                }
            );

            if (!response.ok) {
                console.error(
                    "Archive read error:",
                    await response.text()
                );
                return [];
            }

            return await response.json();

        } catch (error) {
            console.error("Archive read error:", error);
            return [];
        }
    }

    async function buildArchivedResponse(newTweets) {
        const archiveSaved =
            await saveTweetsToSupabase(newTweets);

        const archivedTweets =
            await getArchivedTweets();

        const combinedTweets =
            mergeTweets(archivedTweets, newTweets);

        return {
            archiveSaved,
            tweets: combinedTweets
        };
    }

    // ==========================================
    // SISTEM BACKUP BERURUTAN
    // ==========================================

    async function tryFallbackProviders() {
        const errors = [];

        const providers = [
            {
                name: "TwitterAPIs",
                fetch: fetchTwitterAPIs
            },
            {
                name: "XDataAPI",
                fetch: fetchXDataAPI
            }
        ];

        for (const provider of providers) {
            const beforeCount =
                providerRequestCounts[provider.name];

            try {
                console.log("Trying backup:", provider.name);

                const rawTweets = await provider.fetch();

                const relevantTweets =
                    rawTweets.filter(isRelevant);

                const uniqueTweets =
                    removeDuplicates(relevantTweets);

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
                    archiveSaved: result.archiveSaved,
                    tweets: result.tweets,
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

                errors.push(
                    `${provider.name}: ${error.message}`
                );
            }
        }

        return {
            provider: null,
            errors
        };
    }

    function sendFallbackResponse(result) {
        return sendResponse(200, {
            success: true,
            activeSources: [result.provider],
            backupSources:
                result.provider === "TwitterAPIs"
                    ? ["SocialData", "XDataAPI"]
                    : ["SocialData", "TwitterAPIs"],
            total: result.tweets.length,
            archiveSaved: result.archiveSaved,
            tweets: result.tweets
        });
    }

    // ==========================================
    // PROSES UTAMA - SOCIALDATA
    // ==========================================

    let socialDataRecorded = false;

    try {
        if (!apiKey) {
            throw new Error(
                "SOCIALDATA_API_KEY belum dipasang"
            );
        }

        let rawTweets = [];
        let cursor = "";

        for (let page = 0; page < 2; page++) {
            const params = new URLSearchParams({
                query,
                type: "Latest"
            });

            if (cursor) {
                params.set("cursor", cursor);
            }

            providerRequestCounts.SocialData++;

            const response = await fetch(
                "https://api.socialdata.tools/twitter/search?" +
                params.toString(),
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Accept": "application/json"
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

            if (!cursor || pageTweets.length === 0) {
                break;
            }
        }

        // Semua request SocialData berhasil.
        let tweets = rawTweets.map(tweet => {
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

        const relevantTweets =
            tweets.filter(isRelevant);

        const uniqueTweets =
            removeDuplicates(relevantTweets);

        if (uniqueTweets.length > 0) {
            sortTweets(uniqueTweets);

            addMonitorEvent(
                "SocialData",
                "success",
                "search"
            );
            socialDataRecorded = true;

            const result =
                await buildArchivedResponse(uniqueTweets);

            return sendResponse(200, {
                success: true,
                activeSources: ["SocialData"],
                backupSources: ["TwitterAPIs", "XDataAPI"],
                total: result.tweets.length,
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
        if (!socialDataRecorded && providerRequestCounts.SocialData > 0) {
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

        // Jika semua API gagal, tampilkan arsip lama.
        const archive =
            await buildArchivedResponse([]);

        return sendResponse(200, {
            success: true,
            activeSources: [],
            backupSources: [
                "SocialData",
                "TwitterAPIs",
                "XDataAPI"
            ],
            total: archive.tweets.length,
            archiveSaved: archive.archiveSaved,
            warning: "Semua API gagal. Menampilkan arsip tersimpan.",
            errors: [
                error.message,
                ...fallback.errors
            ],
            tweets: archive.tweets
        });
    }
}
