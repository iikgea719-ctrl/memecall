
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.TWEXAPI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const cronSecret = process.env.CRON_SECRET;

    if (!apiKey || !supabaseUrl || !supabaseKey || !cronSecret) {
        return res.status(500).json({
            success: false,
            error: "Missing environment variables"
        });
    }

    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized"
        });
    }

    const baseUrl = supabaseUrl.replace(/\/$/, "");

    const supabaseHeaders = {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
    };

    try {
        // Ambil satu akun aktif yang paling lama belum diperiksa
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?is_active=eq.true&select=id,username&order=last_checked_at.asc.nullsfirst&limit=1`,
            {
                headers: supabaseHeaders
            }
        );

        const accounts = await accountsResponse.json();

        if (!accountsResponse.ok) {
            return res.status(500).json({
                success: false,
                error: "Failed to load account queue",
                details: accounts
            });
        }

        if (!accounts.length) {
            return res.status(200).json({
                success: true,
                message: "No active influencer accounts",
                processed: 0
            });
        }

        const account = accounts[0];

        // Ambil 20 postingan terbaru dari TwexAPI
        const apiResponse = await fetch(
            `https://api.twexapi.io/twitter/${encodeURIComponent(account.username)}/timeline/page`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    count: 20,
                    next_cursor: ""
                })
            }
        );

        const apiResult = await apiResponse.json();

        if (!apiResponse.ok || !Array.isArray(apiResult?.data)) {
            return res.status(502).json({
                success: false,
                username: account.username,
                error: "TwexAPI request failed",
                details: apiResult
            });
        }

        const tweets = apiResult.data;

        // Ubah format TwexAPI menjadi format Supabase
        const posts = tweets
            .filter(tweet => tweet.tweet_id)
            .map(tweet => {
                const username =
                    tweet.author_screen_name || account.username;

                const tweetId = String(tweet.tweet_id);

                const parsedDate = tweet.created_at
                    ? new Date(tweet.created_at)
                    : null;

                const postedAt =
                    parsedDate && !Number.isNaN(parsedDate.getTime())
                        ? parsedDate.toISOString()
                        : null;

                return {
                    post_id: tweetId,
                    account_id: account.id,
                    username: username,
                    post_text: tweet.full_text || "",
                    media:
                        tweet.media ||
                        tweet.extended_entities?.media ||
                        [],
                    post_url: `https://x.com/${username}/status/${tweetId}`,
                    posted_at: postedAt
                };
            });

        // Simpan hanya postingan baru.
        // Postingan lama tidak dihapus atau ditimpa.
        let saved = 0;

        if (posts.length > 0) {
            const saveResponse = await fetch(
                `${baseUrl}/rest/v1/influencer_posts?on_conflict=post_id`,
                {
                    method: "POST",
                    headers: {
                        ...supabaseHeaders,
                        Prefer: "resolution=ignore-duplicates,return=representation"
                    },
                    body: JSON.stringify(posts)
                }
            );

            const savedData = await saveResponse.json();

            if (!saveResponse.ok) {
                return res.status(500).json({
                    success: false,
                    username: account.username,
                    error: "Failed to save posts",
                    details: savedData
                });
            }

            saved = Array.isArray(savedData)
                ? savedData.length
                : 0;
        }

        // Tandai akun sudah berhasil diperiksa
        const updateResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?id=eq.${account.id}`,
            {
                method: "PATCH",
                headers: {
                    ...supabaseHeaders,
                    Prefer: "return=minimal"
                },
                body: JSON.stringify({
                    last_checked_at: new Date().toISOString()
                })
            }
        );

        if (!updateResponse.ok) {
            const updateError = await updateResponse.text();

            return res.status(500).json({
                success: false,
                username: account.username,
                error: "Failed to update account queue",
                details: updateError,
                saved
            });
        }

        return res.status(200).json({
            success: true,
            provider: "TwexAPI",
            username: account.username,
            fetched: tweets.length,
            saved,
            processed: 1,
            message: "Influencer account processed successfully"
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "Internal server error",
            message: error.message
        });
    }
}
