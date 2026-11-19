
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
    const monitorEvents = [];

    const providerRoles = {
        TwexAPI: "primary",
        Weir: "backup 1",
        XFetch: "backup 2"
    };

    const providerRequestCounts = {
        TwexAPI: 0,
        Weir: 0,
        XFetch: 0
    };

    // ==========================================
    // MONITORING API
    // ==========================================

    function recordProvider(
        provider,
        status,
        action,
        username,
        error = null
    ) {
        monitorEvents.push({
            module: "influencers",
            provider,
            role: providerRoles[provider],
            status,
            action,
            username: username || null,
            requests_count:
                providerRequestCounts[provider] || 0,
            error_message: error
                ? String(error).slice(0, 2000)
                : null,
            created_at: new Date().toISOString()
        });
    }

    async function flushMonitoring() {
        if (!monitorEvents.length) return;

        const headers = {
            ...supabaseHeaders,
            Prefer: "return=minimal"
        };

        const latestByProvider = new Map();

        for (const event of monitorEvents) {
            latestByProvider.set(event.provider, event);
        }

        const logs = monitorEvents.map(event => ({
            module: event.module,
            provider: event.provider,
            username: event.username,
            action: event.action,
            status: event.status,
            requests_count: event.requests_count,
            error_message: event.error_message,
            created_at: event.created_at
        }));

        const providerUpdates = Array.from(
            latestByProvider.values()
        ).map(event => ({
            module: "influencers",
            provider: event.provider,
            role: event.role,
            status: event.status === "success"
                ? "active"
                : "error",
            last_checked_at: event.created_at,
            last_used_at: event.created_at,
            last_error: event.error_message
        }));

        try {
            const results = await Promise.all([
                fetch(
                    `${baseUrl}/rest/v1/api_usage_logs`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify(logs)
                    }
                ),

                fetch(
                    `${baseUrl}/rest/v1/api_provider_status?on_conflict=module,provider`,
                    {
                        method: "POST",
                        headers: {
                            ...headers,
                            Prefer: "resolution=merge-duplicates,return=minimal"
                        },
                        body: JSON.stringify(providerUpdates)
                    }
                )
            ]);

            if (!results[0].ok) {
                console.error(
                    "Influencer monitoring logs failed:",
                    await results[0].text()
                );
            }

            if (!results[1].ok) {
                console.error(
                    "Influencer provider status failed:",
                    await results[1].text()
                );
            }
        } catch (error) {
            console.error(
                "Influencer monitoring error:",
                error.message
            );
        }
    }

    async function sendJson(status, payload) {
        await flushMonitoring();
        return res.status(status).json(payload);
    }

    // ==========================================
    // JSON PROVIDER
    // ==========================================

    async function readJson(response) {
        const text = await response.text();

        try {
            return text ? JSON.parse(text) : {};
        } catch {
            throw new Error("Provider returned invalid JSON");
        }
    }
    
function isAccountNotFound(response, result) {
    const status = response.status;

    const code = String(
        result?.code ||
        result?.status ||
        result?.error_code ||
        ""
    ).toLowerCase();

    const message = String(
        result?.message ||
        result?.error ||
        result?.msg ||
        ""
    ).toLowerCase();

    return (
    code === "user_not_found" ||
    code === "account_not_found" ||
    /user not found|account not found|profile not found|user does not exist|account does not exist/.test(message)
);
}

function providerError(response, result, label) {
    const error = new Error(
        `${label} HTTP ${response.status}: ` +
        (
            result?.message ||
            result?.error ||
            result?.msg ||
            "Request failed"
        )
    );

    error.isAccountNotFound =
        isAccountNotFound(response, result);

    return error;
}


    // ==========================================
    // NORMALISASI POSTINGAN
    // ==========================================
    
function normalizePosts(tweets, account) {
    function extractMedia(tweet) {
        // Periksa beberapa kemungkinan struktur media dari provider.
        const candidates = [
            tweet.media,
            tweet.extended_entities?.media,
            tweet.entities?.media,
            tweet.attachments?.media,
            tweet.attachments?.photos,
            tweet.photos
        ];

        let mediaItems = [];

        for (const candidate of candidates) {
            if (Array.isArray(candidate) && candidate.length > 0) {
                mediaItems = candidate;
                break;
            }
        }

        return mediaItems.map(item => {
            if (typeof item === "string") {
                return {
                    url: item,
                    type: "photo"
                };
            }

            if (!item || typeof item !== "object") {
                return null;
            }

            const mediaUrl =
                item.media_url_https ||
                item.media_url ||
                item.image_url ||
                item.imageUrl ||
                item.url ||
                item.preview_image_url ||
                item.preview_image?.url ||
                null;

            if (!mediaUrl) return null;

            return {
                url: mediaUrl,
                type:
                    item.type ||
                    item.media_type ||
                    "photo"
            };
        }).filter(item => item && item.url);
    }

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
                    tweet.content ||
                    "",
                media: extractMedia(tweet),
                post_url:
                    tweet.url ||
                    `https://x.com/${account.username}/status/${postId}`,
                posted_at: postedAt
            };
        });
}

    // ==========================================
    // UPDATE FOTO PROFIL
    // ==========================================

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

    // ==========================================
    // TWEXAPI - PROVIDER UTAMA
    // ==========================================

    async function tryTwex(account) {
        const apiKey = providerKeys.TwexAPI;

        if (!apiKey) {
            throw new Error("TWEXAPI_API_KEY tidak tersedia");
        }

        let profileImage = null;
        let profileError = null;

        if (!account.profile_image_url) {
            try {
                providerRequestCounts.TwexAPI++;

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

            await new Promise(resolve =>
                setTimeout(resolve, 5500)
            );
        }

        providerRequestCounts.TwexAPI++;

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
    throw providerError(
        response,
        result,
        "TwexAPI Timeline"
    );
}


        return {
            provider: "TwexAPI",
            tweets: result.data,
            profileImage,
            profileError
        };
    }

    // ==========================================
    // WEIR - BACKUP 1
    // ==========================================

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

        if (!account.profile_image_url) {
            try {
                providerRequestCounts.Weir++;

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

        providerRequestCounts.Weir++;

        const response = await fetch(
            `https://api.weirapp.io/v1/x/users/${encodeURIComponent(account.username)}/posts?limit=20`,
            { headers }
        );

        const result = await readJson(response);

        
if (!response.ok || !Array.isArray(result?.data)) {
    throw providerError(
        response,
        result,
        "Weir Timeline"
    );
}


        return {
            provider: "Weir",
            tweets: result.data,
            profileImage,
            profileError
        };
    }

    // ==========================================
    // XFETCH - BACKUP 2
    // ==========================================

    async function tryXFetch(account) {
        const apiKey = providerKeys.XFetch;

        if (!apiKey) {
            throw new Error("XFETCH_API_KEY tidak tersedia");
        }

        providerRequestCounts.XFetch++;

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
    throw providerError(
        response,
        result,
        "XFetch Profile/Timeline"
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

    // ==========================================
    // PINDAHKAN AKUN KE BELAKANG ANTREAN
    // ==========================================
    
async function deactivateAccount(account) {
    const response = await fetch(
        `${baseUrl}/rest/v1/influencer_accounts?id=eq.${account.id}`,
        {
            method: "PATCH",
            headers: {
                ...supabaseHeaders,
                Prefer: "return=minimal"
            },
            body: JSON.stringify({
                is_active: false,
                last_checked_at: new Date().toISOString()
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            "Gagal menonaktifkan akun: " +
            await response.text()
        );
    }
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

    // ==========================================
    // PROSES UTAMA
    // ==========================================

    try {
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?is_active=eq.true&select=id,username,profile_image_url&order=last_checked_at.asc.nullsfirst&limit=1`,
            { headers: supabaseHeaders }
        );

        const accounts = await readJson(accountsResponse);

        if (!accountsResponse.ok) {
            return sendJson(500, {
                success: false,
                error: "Failed to load account queue",
                details: accounts
            });
        }

        if (!Array.isArray(accounts) || accounts.length === 0) {
            return sendJson(200, {
                success: true,
                message: "No active influencer accounts",
                processed: 0
            });
        }

        const account = accounts[0];

        // ======================================
        // MODE TEST DAN URUTAN PROVIDER
        // ======================================

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
            return sendJson(400, {
                success: false,
                error: "Invalid testProvider. Use weir or xfetch."
            });
        }

        // ======================================
        // COBA PROVIDER SECARA BERURUTAN
        // ======================================

        let providerResult = null;
let notFoundCount = 0;

        for (const provider of providers) {
            const providerName = {
                tryTwex: "TwexAPI",
                tryWeir: "Weir",
                tryXFetch: "XFetch"
            }[provider.name];

            try {
                providerResult = await provider(account);

                recordProvider(
                    providerName,
                    "success",
                    testProvider
                        ? `test_${testProvider}`
                        : "timeline_fetch",
                    account.username
                );

                break;

            } catch (error) {
                recordProvider(
                    providerName,
                    "failed",
                    testProvider
                        ? `test_${testProvider}`
                        : "timeline_fetch",
                    account.username,
                    error.message
                );
                                if (error.isAccountNotFound === true) {
                    notFoundCount++;
                }

                providerErrors.push({
                    provider: providerName,
                    error: error.message
                });
            }
        }

        // ======================================
        // SEMUA PROVIDER GAGAL
        // ======================================

        
if (!providerResult) {

    if (
        !testProvider &&
        notFoundCount === providers.length
    ) {
        await deactivateAccount(account);

        return sendJson(200, {
            success: true,
            username: account.username,
            deactivated: true,
            reason: "Account not found by all providers",
            processed: 1,
            message: "Invalid influencer account automatically disabled"
        });
    }

    await moveAccountToBack(account);

    return sendJson(502, {
        success: false,
        username: account.username,
        error: "All influencer providers failed",
        providerErrors,
        processed: 1
    });
}


        // ======================================
        // UPDATE FOTO PROFIL
        // ======================================

        const profileResult = await updateProfileImage(
            account,
            providerResult.profileImage
        );

        // ======================================
        // NORMALISASI DAN SIMPAN POSTINGAN
        // ======================================

        const posts = normalizePosts(
            providerResult.tweets,
            account
        );

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

            const savedData = await readJson(saveResponse);

            if (!saveResponse.ok) {
                return sendJson(500, {
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

        // ======================================
        // SELESAI
        // ======================================

        await moveAccountToBack(account);

        return sendJson(200, {
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
        return sendJson(500, {
            success: false,
            error: "Internal server error",
            message: error.message
        });
    }
}
