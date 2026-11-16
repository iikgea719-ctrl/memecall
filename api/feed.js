
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const query = req.query.q || "memecoin";
    const sorsaKey = process.env.SORSA_API_KEY;
    const twitterKey = process.env.TWITTERAPI_IO_KEY;

    // API 1: TWITTERAPI.IO (UTAMA)
    try {
        if (twitterKey) {
            const params = new URLSearchParams({
                query,
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

            if (response.ok) {
                const data = await response.json();

                const tweets = (data.tweets || []).map(tweet => {
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

                if (tweets.length > 0) {
                    return res.status(200).json({
                        success: true,
                        activeSources: ["TwitterAPI.io"],
                        backupSources: ["Sorsa"],
                        total: tweets.length,
                        tweets
                    });
                }
            }
        }
    } catch (error) {
        console.log("TwitterAPI.io failed:", error.message);
    }

    // API 2: SORSA (CADANGAN)
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

    // Semua API gagal
    return res.status(503).json({
        success: false,
        error: "Semua sumber X sedang tidak tersedia"
    });
}
