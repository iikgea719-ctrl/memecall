
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const query = req.query.q || "memecoin";
    const twtapiKey = process.env.TWTAPI_KEY;
    const sorsaKey = process.env.SORSA_API_KEY;

    // FILTER TOPIK MEMECOIN
    function isRelevant(tweet) {
        const text = (tweet.full_text || "").toLowerCase();

        const keywords = [
            "memecoin",
            "meme coin",
            "meme",
            "pump.fun",
            "pumpfun",
            "solana",
            "token",
            "coin",
            "crypto",
            "dex",
            "bonding curve",
            "market cap",
            "pump",
            "degen",
            "launch",
            "ca:",
            "rug",
            "liquidity",
            "holder",
            "trading",
            "alpha",
            "new coin",
            "new token"
        ];

        return keywords.some(keyword => text.includes(keyword));
    }

    // HAPUS TWEET DUPLIKAT
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

    // URUTKAN TWEET TERBARU
    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime() || 0;
            const dateB = new Date(b.created_at || 0).getTime() || 0;

            return dateB - dateA;
        });
    }

    
    // TWTAPI - SUMBER UTAMA
    try {
        if (twtapiKey) {
            let rawTweets = [];
            let cursor = "";

            // AMBIL MAKSIMAL 2 HALAMAN
            for (let page = 0; page < 2; page++) {
                const params = new URLSearchParams({
                    q: "memecoin OR pump.fun OR solana meme OR meme coin",
                    product: "Latest",
                    count: "200"
                });

                if (cursor) {
                    params.set("cursor", cursor);
                }

                const response = await fetch(
                    "https://api.twtapi.io/search?" + params.toString(),
                    {
                        headers: {
                            "X-API-Key": twtapiKey
                        }
                    }
                );

                if (!response.ok) {
                    console.log("TwtAPI status:", response.status);
                    break;
                }

                const data = await response.json();
                const pageTweets = data.tweets || [];

                rawTweets.push(...pageTweets);

                cursor = data.cursor_bottom || "";

                if (!cursor || pageTweets.length === 0) {
                    break;
                }
            }

            const tweets = rawTweets.map(tweet => ({
                id: tweet.tweet_id || tweet.id,
                full_text: tweet.text || "",
                created_at: tweet.created_at || "",
                user: {
                    name: tweet.user?.name || "X User",
                    username: tweet.user?.screen_name || "",
                    profile_image_url:
                        tweet.user?.avatar_url || ""
                },
                entities: (tweet.media || []).map(item => ({
                    type: item.type || "photo",
                    link: item.url || item.media_url || "",
                    preview:
                        item.thumb || item.url || item.media_url || ""
                }))
            }));

            const relevantTweets = tweets.filter(isRelevant);
            const uniqueTweets = removeDuplicates(relevantTweets);

            sortTweets(uniqueTweets);

            if (uniqueTweets.length > 0) {
                return res.status(200).json({
                    success: true,
                    activeSources: ["TwtAPI"],
                    backupSources: ["Sorsa"],
                    total: uniqueTweets.length,
                    tweets: uniqueTweets
                });
            }
        }
    } catch (error) {
        console.log("TwtAPI failed:", error.message);
    }


    // SORSA - SUMBER CADANGAN
    try {
        if (sorsaKey) {
            const response = await fetch(
                "https://api.sorsa.io/v3/search-tweets",
                {
                    method: "POST",
                    headers: {
                        "ApiKey": sorsaKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        query,
                        order: "latest"
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();

                const tweets = data.tweets || [];

                if (tweets.length > 0) {
                    return res.status(200).json({
                        success: true,
                        activeSources: ["Sorsa"],
                        backupSources: [],
                        total: tweets.length,
                        tweets
                    });
                }
            } else {
                console.log("Sorsa status:", response.status);
            }
        }
    } catch (error) {
        console.log("Sorsa failed:", error.message);
    }

    return res.status(503).json({
        success: false,
        error: "Semua sumber X sedang tidak tersedia"
    });
}
