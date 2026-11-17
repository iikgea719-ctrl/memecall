
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

    function sortTweets(tweets) {
        return tweets.sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime() || 0;
            const dateB = new Date(b.created_at || 0).getTime() || 0;

            return dateB - dateA;
        });
    }
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
            fields: "author.profile_image_url,media.media_url_https,media.type"
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
                data.message || data.error || "TwitterAPIs gagal"
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

    try {
        let rawTweets = [];
        let cursor = "";

        // Ambil maksimal 2 halaman
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

    if (response.status === 402) {
        try {
            const backupTweets = await fetchTwitterAPIs();

            const relevantTweets = backupTweets.filter(isRelevant);
            const uniqueTweets = removeDuplicates(relevantTweets);

            sortTweets(uniqueTweets);

            return res.status(200).json({
                success: true,
                activeSources: ["TwitterAPIs"],
                backupSources: ["SocialData"],
                total: uniqueTweets.length,
                tweets: uniqueTweets
            });

        } catch (backupError) {
            console.log("TwitterAPIs backup failed:", backupError.message);

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

        const tweets = rawTweets.map(tweet => {
            const media = [
                ...(tweet.extended_entities?.media || []),
                ...(tweet.entities?.media || [])
            ];

            return {
                id: tweet.id_str || tweet.id,
                full_text: tweet.full_text || tweet.text || "",
                created_at:
                    tweet.tweet_created_at || tweet.created_at || "",

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

        sortTweets(uniqueTweets);

        return res.status(200).json({
    success: true,
    activeSources: ["SocialData"],
    backupSources: ["TwitterAPIs"],
    total: uniqueTweets.length,
    tweets: uniqueTweets
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
