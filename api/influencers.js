
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const twitterKey = process.env.TWITTRAPI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const cronSecret = process.env.CRON_SECRET;

    if (!twitterKey || !supabaseUrl || !supabaseKey || !cronSecret) {
        return res.status(500).json({
            error: "Missing API environment variables"
        });
    }

    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({
            error: "Unauthorized"
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

    const baseUrl = supabaseUrl.replace(/\/$/, "");

    const supabaseHeaders = {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
    };

    const result = {
        success: true,
        source: "TwittrAPI",
        accounts: 0,
        fetched: 0,
        relevant: 0,
        saved: 0,
        failed: []
    };

    try {
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?is_active=eq.true&select=id,username,display_name`,
            {
                headers: supabaseHeaders
            }
        );

        const accounts = await accountsResponse.json();

        if (!accountsResponse.ok) {
            return res.status(500).json({
                error: "Failed to load influencer accounts",
                details: accounts
            });
        }

        result.accounts = accounts.length;

        for (const account of accounts) {
            try {
                const apiUrl = new URL(
                    "https://api.twittrapi.com/user/-1/tweets"
                );

                apiUrl.searchParams.set("username", account.username);
                apiUrl.searchParams.set("count", "5");
                apiUrl.searchParams.set("format", "simple");

                const apiResponse = await fetch(apiUrl, {
                    headers: {
                        "X-API-KEY": twitterKey
                    }
                });

                const apiData = await apiResponse.json();

                if (!apiResponse.ok) {
                    result.failed.push({
                        username: account.username,
                        error: "TwittrAPI request failed"
                    });
                    continue;
                }

                const tweets = Array.isArray(apiData.data)
                    ? apiData.data.slice(0, 5)
                    : [];

                result.fetched += tweets.length;

                const relevantTweets = tweets.filter(tweet => {
                    const content = String(
                        tweet.text || ""
                    ).toLowerCase();

                    return keywords.some(word =>
                        content.includes(word)
                    );
                });

                result.relevant += relevantTweets.length;

                const posts = relevantTweets
                    .filter(tweet => tweet.id)
                    .map(tweet => ({
                        post_id: String(tweet.id),
                        account_id: account.id,
                        username: account.username,
                        post_text: tweet.text || "",
                        media: tweet.media || [],
                        post_url: tweet.url || null,
                        posted_at: tweet.createdAt || null
                    }));

                if (posts.length > 0) {
                    const saveResponse = await fetch(
                        `${baseUrl}/rest/v1/influencer_posts?on_conflict=post_id`,
                        {
                            method: "POST",
                            headers: {
                                ...supabaseHeaders,
                                "Prefer": "resolution=ignore-duplicates,return=representation"
                            },
                            body: JSON.stringify(posts)
                        }
                    );

                    const savedData = await saveResponse.json();

                    if (!saveResponse.ok) {
                        result.failed.push({
                            username: account.username,
                            error: "Supabase save failed",
                            details: savedData
                        });
                        continue;
                    }

                    result.saved += Array.isArray(savedData)
                        ? savedData.length
                        : 0;
                }

            } catch (error) {
                result.failed.push({
                    username: account.username,
                    error: error.message
                });
            }
        }

        result.success = result.failed.length === 0;

        return res.status(200).json(result);

    } catch (error) {
        return res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
}
