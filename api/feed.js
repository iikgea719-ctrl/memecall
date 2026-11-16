
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const query = req.query.q || "memecoin";
    const sorsaKey = process.env.SORSA_API_KEY;
    const twitterKey = process.env.TWITTERAPI_IO_KEY;
    const twtapiKey = process.env.TWTAPI_KEY;

    // TWTAPI
    let twtapiTweets = [];

    try {
        if (twtapiKey) {
            const params = new URLSearchParams({
                q: "memecoin OR pump.fun OR solana meme OR meme coin",
                product: "Latest",
                count: "20"
            });

            const response = await fetch(
                "https://api.twtapi.io/search?" + params.toString(),
                {
                    headers: {
                        "X-API-Key": twtapiKey
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();

                twtapiTweets = (data.tweets || []).map(tweet => ({
                    id: tweet.tweet_id,
                    full_text: tweet.text || "",
                    created_at: tweet.created_at,
                    user: {
                        name: tweet.user?.name || "X User",
                        username: tweet.user?.screen_name || "",
                        profile_image_url: tweet.user?.avatar_url || ""
                    },
                    entities: (tweet.media || []).map(item => ({
                        type: item.type || "photo",
                        link: item.url || item.media_url || "",
                        preview: item.thumb || item.url || item.media_url || ""
                    }))
                }));
            }
        }
    } catch (error) {
        console.log("TwtAPI failed:", error.message);
    }

    // TWITTERAPI.IO
    try {
        if (twitterKey) {
            const params = new URLSearchParams({
                query: "(memecoin OR pump.fun OR solana meme OR meme coin)",
                queryType: "Latest"
            });

            const extraParams = new URLSearchParams({
                query: "(new solana token OR solana memecoin OR meme coin launch)",
                queryType: "Latest"
            });

            const response = await fetch(
                "https://api.twitterapi.io/twitter/tweet/advanced_search?" +
                params.toString(),
                {
                    headers: {
                        "X-API-Key": twitterKey
                    }
                }
            );

            let extraTweets = [];

            try {
                const extraResponse = await fetch(
                    "https://api.twitterapi.io/twitter/tweet/advanced_search?" +
                    extraParams.toString(),
                    {
                        headers: {
                            "X-API-Key": twitterKey
                        }
                    }
                );

                if (extraResponse.ok) {
                    const extraData = await extraResponse.json();
                    extraTweets = extraData.tweets || [];
                }
            } catch (error) {
                console.log("Extra search failed:", error.message);
            }

            if (response.ok) {
                const data = await response.json();

                const tweets = [
                    ...(data.tweets || []),
                    ...extraTweets
                ].map(tweet => {
                    const media = tweet.extendedEntities?.media || [];

                    return {
                        id: tweet.id,
                        full_text: tweet.text || "",
                        created_at: tweet.createdAt,
                        user: {
                            name: tweet.author?.name || "X User",
                            username: tweet.author?.userName || "",
                            profile_image_url:
                                tweet.author?.profilePicture || ""
                        },
                        entities: media.map(item => ({
                            type: item.type,
                            link: item.type === "video"
                                ? (
                                    item.video_info?.variants
                                        ?.filter(v => v.content_type === "video/mp4")
                                        ?.sort((a, b) =>
                                            (b.bitrate || 0) -
                                            (a.bitrate || 0)
                                        )[0]?.url ||
                                    item.media_url_https
                                )
                                : item.media_url_https,
                            preview: item.media_url_https
                        }))
                    };
                });

                const combinedTweets = [
                    ...twtapiTweets,
                    ...tweets
                ];

                const relevantTweets = combinedTweets.filter(tweet => {
                    const text = (tweet.full_text || "").toLowerCase();

                    return [
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
                        "holder"
                    ].some(keyword => text.includes(keyword));
                });

                const uniqueTweets = Array.from(
                    new Map(
                        relevantTweets.map(tweet => [tweet.id, tweet])
                    ).values()
                );

                uniqueTweets.sort((a, b) =>
                    new Date(b.created_at) - new Date(a.created_at)
                );

                if (uniqueTweets.length > 0) {
                    return res.status(200).json({
                        success: true,
                        activeSources: ["TwtAPI", "TwitterAPI.io"],
                        backupSources: ["Sorsa"],
                        total: uniqueTweets.length,
                        tweets: uniqueTweets
                    });
                }
            }
        }
    } catch (error) {
        console.log("TwitterAPI.io failed:", error.message);
    }

    // SORSA BACKUP
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
