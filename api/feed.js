
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

    // FILTER POSTINGAN RELEVAN
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

    // HAPUS DUPLIKAT HASIL API
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

    // URUTKAN TERBARU DI ATAS
    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA =
                new Date(a.created_at || 0).getTime() || 0;

            const dateB =
                new Date(b.created_at || 0).getTime() || 0;

            return dateB - dateA;
        });
    }

    // GABUNGKAN ARSIP DAN POSTINGAN BARU BERDASARKAN ID
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
    // TWITTERAPIS - CADANGAN 1
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
    // XDATAAPI - CADANGAN 2
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

    // AMBIL ARSIP DARI SUPABASE
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

    // SIMPAN DAN GABUNGKAN DENGAN ARSIP
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
    // SISTEM CADANGAN BERURUTAN
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
            try {
                console.log("Trying backup:", provider.name);

                const rawTweets = await provider.fetch();

                const relevantTweets =
                    rawTweets.filter(isRelevant);

                const uniqueTweets =
                    removeDuplicates(relevantTweets);

                if (!uniqueTweets.length) {
                    errors.push(
                        `${provider.name}: tidak ada postingan relevan`
                    );
                    continue;
                }

                sortTweets(uniqueTweets);

                const result =
                    await buildArchivedResponse(uniqueTweets);

                return {
                    provider: provider.name,
                    archiveSaved: result.archiveSaved,
                    tweets: result.tweets,
                    errors
                };

            } catch (error) {
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

    // RESPONS JIKA API CADANGAN BERHASIL
    function sendFallbackResponse(result) {
        return res.status(200).json({
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

        // FORMAT DATA SOCIALDATA
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

        const relevantTweets =
            tweets.filter(isRelevant);

        const uniqueTweets =
            removeDuplicates(relevantTweets);

        // JIKA SOCIALDATA MENGHASILKAN POSTINGAN
        if (uniqueTweets.length > 0) {
            sortTweets(uniqueTweets);

            const result =
                await buildArchivedResponse(uniqueTweets);

            return res.status(200).json({
                success: true,
                activeSources: ["SocialData"],
                backupSources: ["TwitterAPIs", "XDataAPI"],
                total: result.tweets.length,
                archiveSaved: result.archiveSaved,
                tweets: result.tweets
            });
        }

        throw new Error(
            "SocialData tidak menghasilkan postingan relevan"
        );

    } catch (error) {
        console.log("SocialData failed:", error.message);

        // COBA TWITTERAPIS, LALU XDATAAPI
        const fallback = await tryFallbackProviders();

        if (fallback.provider) {
            return sendFallbackResponse(fallback);
        }

        // JIKA SEMUA API GAGAL, TAMPILKAN ARSIP LAMA
        const archive =
            await buildArchivedResponse([]);

        return res.status(200).json({
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
