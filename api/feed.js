
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.SOCIALDATA_API_KEY;
    const backupApiKey = process.env.TWITTERAPIS_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "SOCIALDATA_API_KEY belum dipasang"
        });
    }

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

    // HAPUS POSTINGAN DUPLIKAT DARI HASIL API
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

    // URUTKAN POSTINGAN TERBARU DI ATAS
    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA =
                new Date(a.created_at || 0).getTime() || 0;

            const dateB =
                new Date(b.created_at || 0).getTime() || 0;

            return dateB - dateA;
        });
    }

    // GABUNGKAN POSTINGAN BARU DAN ARSIP BERDASARKAN ID
    function mergeTweets(archivedTweets, newTweets) {
        const combined = new Map();

        for (const tweet of archivedTweets) {
            if (tweet.id) {
                combined.set(String(tweet.id), tweet);
            }
        }

        // Data terbaru menggantikan data lama jika ID sama
        for (const tweet of newTweets) {
            if (tweet.id) {
                combined.set(String(tweet.id), tweet);
            }
        }

        return sortTweets(Array.from(combined.values()));
    }

    // UBAH FORMAT TWEET TWITTERAPIS
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

    // AMBIL DATA DARI TWITTERAPIS
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

    // SIMPAN POSTINGAN KE SUPABASE
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

    // AMBIL SEMUA POSTINGAN DARI ARSIP SUPABASE
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

    // AMBIL ARSIP DAN GABUNGKAN DENGAN HASIL TERBARU
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

    // PROSES UTAMA
    try {
        let rawTweets = [];
        let cursor = "";

        // AMBIL MAKSIMAL 2 HALAMAN DARI SOCIALDATA
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
                console.log(
                    "SocialData status:",
                    response.status,
                    responseText
                );

                // JIKA SOCIALDATA KEHABISAN KREDIT (402),
                // GUNAKAN TWITTERAPIS SEBAGAI CADANGAN
                if (response.status === 402) {
                    try {
                        const backupTweets =
                            await fetchTwitterAPIs();

                        const relevantTweets =
                            backupTweets.filter(isRelevant);

                        const uniqueTweets =
                            removeDuplicates(relevantTweets);

                        sortTweets(uniqueTweets);

                        const result =
                            await buildArchivedResponse(uniqueTweets);

                        return res.status(200).json({
                            success: true,
                            activeSources: ["TwitterAPIs"],
                            backupSources: ["SocialData"],
                            total: result.tweets.length,
                            archiveSaved: result.archiveSaved,
                            tweets: result.tweets
                        });

                    } catch (backupError) {
                        console.log(
                            "TwitterAPIs backup failed:",
                            backupError.message
                        );

                        return res.status(502).json({
                            success: false,
                            source: "TwitterAPIs",
                            error: backupError.message
                        });
                    }
                }

                return res.status(response.status).json({
                    success: false,
                    source: "SocialData",
                    error: "SocialData API gagal mengambil tweet",
                    details: responseText
                });
            }

            const data = JSON.parse(responseText);
            const pageTweets = data.tweets || [];

            rawTweets.push(...pageTweets);

            cursor = data.next_cursor || "";

            if (!cursor || pageTweets.length === 0) {
                break;
            }
        }

        // UBAH FORMAT DATA SOCIALDATA
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

        // FILTER DAN HAPUS DUPLIKAT HASIL API
        const relevantTweets = tweets.filter(isRelevant);
        const uniqueTweets = removeDuplicates(relevantTweets);

        sortTweets(uniqueTweets);

        // SIMPAN DAN GABUNGKAN DENGAN ARSIP
        const result =
            await buildArchivedResponse(uniqueTweets);

        return res.status(200).json({
            success: true,
            activeSources: ["SocialData"],
            backupSources: ["TwitterAPIs"],
            total: result.tweets.length,
            archiveSaved: result.archiveSaved,
            tweets: result.tweets
        });

    } catch (error) {
        console.log("SocialData failed:", error.message);

        return res.status(500).json({
            success: false,
            source: "SocialData",
            error: error.message
        });
    }
}
