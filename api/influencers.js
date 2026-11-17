
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const twitterKey = process.env.TWITTRAPI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!twitterKey || !supabaseUrl || !supabaseKey) {
        return res.status(500).json({
            error: "Missing API environment variables"
        });
    }

    const username = String(
        req.query.username || "elonmusk"
    ).replace(/^@/, "").trim();

    if (!/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
        return res.status(400).json({
            error: "Invalid username"
        });
    }

    const keywords = [
        "crypto", "memecoin", "meme coin",
        "bitcoin", "btc", "ethereum", "eth",
        "solana", "sol", "token", "blockchain",
        "defi", "web3", "nft", "doge", "shib",
        "xrp", "pump.fun", "pumpfun", "dex",
        "wallet", "trading", "cryptocurrency"
    ];

    const supabaseHeaders = {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
    };

    try {
        const apiUrl = new URL(
            "https://api.twittrapi.com/user/-1/tweets"
        );

        apiUrl.searchParams.set("username", username);
        apiUrl.searchParams.set("count", "5");
        apiUrl.searchParams.set("format", "simple");

        const apiResponse = await fetch(apiUrl, {
            headers: {
                "X-API-KEY": twitterKey
            }
        });

        const apiData = await apiResponse.json();

        if (!apiResponse.ok) {
            return res.status(apiResponse.status).json({
                error: "TwittrAPI request failed",
                details: apiData
            });
        }

        const tweets = Array.isArray(apiData.data)
            ? apiData.data.slice(0, 5)
            : [];

        const relevantTweets = tweets.filter(tweet => {
            const content = String(tweet.text || "").toLowerCase();
            return keywords.some(word => content.includes(word));
        });

        const accountResponse = await fetch(
            `${supabaseUrl}/rest/v1/influencer_accounts?on_conflict=username`,
            {
                method: "POST",
                headers: {
                    ...supabaseHeaders,
                    "Prefer": "resolution=merge-duplicates,return=representation"
                },
                body: JSON.stringify([{
                    username,
                    display_name: tweets[0]?.author?.name || username,
                    profile_image_url: tweets[0]?.author?.avatarUrl || null,
                    category: "crypto",
                    is_active: true
                }])
            }
        );

        const accountData = await accountResponse.json();

        if (!accountResponse.ok) {
            return res.status(500).json({
                error: "Supabase account save failed",
                details: accountData
            });
        }

        const accountId = accountData[0]?.id;

        if (!accountId) {
            return res.status(500).json({
                error: "Could not retrieve influencer account ID"
            });
        }

        const posts = relevantTweets.map(tweet => ({
            post_id: String(tweet.id),
            account_id: accountId,
            username,
            post_text: tweet.text || "",
            media: tweet.media || [],
            post_url: tweet.url || null,
            posted_at: tweet.createdAt || null
        }));

        let savedPosts = [];

        if (posts.length > 0) {
            const saveResponse = await fetch(
                `${supabaseUrl}/rest/v1/influencer_posts?on_conflict=post_id`,
                {
                    method: "POST",
                    headers: {
                        ...supabaseHeaders,
                        "Prefer": "resolution=ignore-duplicates,return=representation"
                    },
                    body: JSON.stringify(posts)
                }
            );

            savedPosts = await saveResponse.json();

            if (!saveResponse.ok) {
                return res.status(500).json({
                    error: "Supabase post save failed",
                    details: savedPosts
                });
            }
        }

        return res.status(200).json({
            success: true,
            source: "TwittrAPI",
            username,
            fetched: tweets.length,
            relevant: relevantTweets.length,
            saved: savedPosts.length,
            message: "Influencer sync completed"
        });

    } catch (error) {
        return res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
}
