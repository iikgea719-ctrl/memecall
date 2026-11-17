
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const cronSecret = process.env.CRON_SECRET;

    const providerKeys = {
        TwexAPI: process.env.TWEXAPI_API_KEY,
        Weir: process.env.WEIR_API_KEY,
        XFetch: process.env.XFETCH_API_KEY
    };

    if (!supabaseUrl || !supabaseKey || !cronSecret) {
        return res.status(500).json({
            success: false,
            error: "Missing Supabase or Cron environment variables"
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

    const providerErrors = [];

    async function readJson(response) {
        const text = await response.text();

        try {
            return text ? JSON.parse(text) : {};
        } catch {
            throw new Error("Provider returned invalid JSON");
        }
    }

    function normalizePosts(tweets, account) {
        return tweets
            .filter(tweet => tweet && (
                tweet.tweet_id || tweet.id
            ))
            .map(tweet => {
                const postId = String(
                    tweet.tweet_id || tweet.id
                );

                const dateValue =
                    tweet.created_at ||
                    tweet.createdAt ||
                    null;

                const parsedDate = dateValue
                    ? new Date(dateValue)
                    : null;

                const postedAt =
                    parsedDate &&
                    !Number.isNaN(parsedDate.getTime())
                        ? parsedDate.toISOString()
                        : null;

                return {
                    post_id: postId,
                    account_id: account.id,
                    username: account.username,
                    post_text:
                        tweet.full_text ||
                        tweet.text ||
                        "",
                    media:
                        tweet.media ||
                        tweet.extended_entities?.media ||
                        [],
                    post_url:
                        tweet.url ||
                        `https://x.com/${account.username}/status/${postId}`,
                    posted_at: postedAt
                };
            });
    }

    async function updateProfileImage(account, imageUrl) {
        if (!imageUrl || account.profile_image_url) {
            return {
                updated: false,
                error: null
            };
        }

        try {
            const response = await fetch(
                `${baseUrl}/rest/v1/influencer_accounts?id=eq.${account.id}`,
                {
                    method: "PATCH",
                    headers: {
                        ...supabaseHeaders,
                        Prefer: "return=minimal"
                    },
                    body: JSON.stringify({
                        profile_image_url: imageUrl
                    })
                }
            );

            if (!response.ok) {
                return {
                    updated: false,
                    error: await response.text()
                };
            }

            account.profile_image_url = imageUrl;

            return {
                updated: true,
                error: null
            };
        } catch (error) {
            return {
                updated: false,
                error: error.message
            };
        }
    }

    async function tryTwex(account) {
        const apiKey = providerKeys.TwexAPI;

        if (!apiKey) {
            throw new Error("TWEXAPI_API_KEY tidak tersedia");
        }

        let profileImage = null;
        let profileError = null;

        // Ambil foto profil hanya jika belum tersedia.
        if (!account.profile_image_url) {
            try {
                const profileResponse = await fetch(
                    "https://api.twexapi.io/twitter/users",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify([
                            account.username
                        ])
                    }
                );

                const profileResult =
                    await readJson(profileResponse);

                if (profileResponse.ok) {
                    const profile = Array.isArray(
                        profileResult?.data
                    )
                        ? profileResult.data[0]
                        : null;

                    profileImage =
                        profile?.profileImageUrlHttps ||
                        profile?.avatar?.image_url ||
                        null;
                } else {
                    profileError =
                        `Profile HTTP ${profileResponse.status}`;
                }
            } catch (error) {
                profileError = error.message;
            }

            // Jaga jeda request TwexAPI.
            await new Promise(resolve =>
                setTimeout(resolve, 5500)
            );
        }

        const response = await fetch(
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

        const result = await readJson(response);

        if (!response.ok || !Array.isArray(result?.data)) {
            throw new Error(
                `Timeline HTTP ${response.status}: ` +
                (result?.message || result?.error || "Request failed")
            );
        }

        return {
            provider: "TwexAPI",
            tweets: result.data,
            profileImage,
            profileError
        };
    }

    async function tryWeir(account) {
        const apiKey = providerKeys.Weir;

        if (!apiKey) {
            throw new Error("WEIR_API_KEY tidak tersedia");
        }

        const headers = {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
        };

        let profileImage = null;
        let profileError = null;

        // Foto profil hanya pelengkap.
        // Kegagalan profile tidak menggagalkan timeline.
        if (!account.profile_image_url) {
            try {
                const profileResponse = await fetch(
                    `https://api.weirapp.io/v1/x/users/${encodeURIComponent(account.username)}`,
                    { headers }
                );

                const profileResult =
                    await readJson(profileResponse);

                if (profileResponse.ok) {
                    profileImage =
                        profileResult?.data?.profileImageUrl ||
                        profileResult?.data?.profile_image_url ||
                        null;
                } else {
                    profileError =
                        `Profile HTTP ${profileResponse.status}`;
                }
            } catch (error) {
                profileError = error.message;
            }
        }

        const response = await fetch(
            `https://api.weirapp.io/v1/x/users/${encodeURIComponent(account.username)}/posts?limit=20`,
            { headers }
        );

        const result = await readJson(response);

        if (!response.ok || !Array.isArray(result?.data)) {
            throw new Error(
                `Timeline HTTP ${response.status}: ` +
                (result?.message || result?.error || "Request failed")
            );
        }

        return {
            provider: "Weir",
            tweets: result.data,
            profileImage,
            profileError
        };
    }

    async function tryXFetch(account) {
        const apiKey = providerKeys.XFetch;

        if (!apiKey) {
            throw new Error("XFETCH_API_KEY tidak tersedia");
        }

        const response = await fetch(
            `https://api.xfetch.io/v1/profiles/by-username/${encodeURIComponent(account.username)}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: "application/json"
                }
            }
        );

        const result = await readJson(response);

        if (
            !response.ok ||
            !Array.isArray(result?.data?.recent_tweets)
        ) {
            throw new Error(
                `Profile/timeline HTTP ${response.status}: ` +
                (result?.message || result?.error || "Invalid response")
            );
        }

        return {
            provider: "XFetch",
            tweets: result.data.recent_tweets,
            profileImage:
                result.data.user?.profile_image_url || null,
            profileError: null
        };
    }

    async function moveAccountToBack(account) {
        const response = await fetch(
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

        if (!response.ok) {
            throw new Error(
                "Gagal memperbarui antrean akun: " +
                await response.text()
            );
        }
    }

    try {
        // Ambil akun aktif yang paling lama belum diperiksa.
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?is_active=eq.true&select=id,username,profile_image_url&order=last_checked_at.asc.nullsfirst&limit=1`,
            { headers: supabaseHeaders }
        );

        const accounts = await readJson(accountsResponse);

        if (!accountsResponse.ok) {
            return res.status(500).json({
                success: false,
                error: "Failed to load account queue",
                details: accounts
            });
        }

        if (!Array.isArray(accounts) || accounts.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No active influencer accounts",
                processed: 0
            });
        }

        const account = accounts[0];

        // Urutan provider: utama, backup 1, backup 2.
        
const testProvider = String(
    req.query.testProvider || ""
).toLowerCase();

let providers;

if (testProvider === "weir") {
    providers = [
        tryWeir,
        tryXFetch
    ];
} else if (testProvider === "xfetch") {
    providers = [
        tryXFetch
    ];
} else if (!testProvider) {
    providers = [
        tryTwex,
        tryWeir,
        tryXFetch
    ];
} else {
    return res.status(400).json({
        success: false,
        error: "Invalid testProvider. Use weir or xfetch."
    });
}

        let providerResult = null;

        for (const provider of providers) {
            try {
                providerResult = await provider(account);
                break;
            } catch (error) {
                providerErrors.push({
                    provider: provider.name
                        .replace("try", ""),
                    error: error.message
                });
            }
        }

        // Semua provider gagal.
        // Geser akun agar akun lain tetap bisa diproses
        // pada jadwal Cron berikutnya.
        if (!providerResult) {
            await moveAccountToBack(account);

            return res.status(502).json({
                success: false,
                username: account.username,
                error: "All influencer providers failed",
                providerErrors,
                processed: 1
            });
        }

        const profileResult = await updateProfileImage(
            account,
            providerResult.profileImage
        );

        const posts = normalizePosts(
            providerResult.tweets,
            account
        );

        let saved = 0;

        // Simpan postingan baru saja.
        // Postingan lama tidak dihapus atau ditimpa.
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

            const savedData = await readJson(saveResponse);

            if (!saveResponse.ok) {
                return res.status(500).json({
                    success: false,
                    username: account.username,
                    provider: providerResult.provider,
                    error: "Failed to save posts",
                    details: savedData
                });
            }

            saved = Array.isArray(savedData)
                ? savedData.length
                : 0;
        }

        // Akun berhasil diproses, pindahkan ke belakang antrean.
        await moveAccountToBack(account);

        return res.status(200).json({
            success: true,
testMode: Boolean(testProvider),
provider: providerResult.provider,
            username: account.username,
            profileUpdated: profileResult.updated,
            profileError:
                profileResult.error ||
                providerResult.profileError ||
                null,
            fetched: providerResult.tweets.length,
            saved,
            processed: 1,
            providerErrors,
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
