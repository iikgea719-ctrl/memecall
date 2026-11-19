
export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const mode = req.query.mode;

    if (
        mode !== "admin-monitor" &&
        mode !== "admin-test-getxapi"
    ) {
        return res.status(404).json({
            success: false,
            error: "Not found"
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    const adminUserId = process.env.ADMIN_USER_ID;

    if (!supabaseUrl || !anonKey || !secretKey || !adminUserId) {
        return res.status(500).json({
            success: false,
            error: "Server configuration incomplete"
        });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";

    if (!accessToken) {
        return res.status(401).json({
            success: false,
            error: "Login required"
        });
    }

    try {
        const baseUrl = supabaseUrl.replace(/\/$/, "");

        // ==========================================
        // VERIFIKASI ADMIN
        // ==========================================

        const authResponse = await fetch(
            `${baseUrl}/auth/v1/user`,
            {
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        if (!authResponse.ok) {
            return res.status(401).json({
                success: false,
                error: "Invalid or expired session"
            });
        }

        const user = await authResponse.json();

        if (user.id !== adminUserId) {
            return res.status(403).json({
                success: false,
                error: "Admin access only"
            });
        }

        const dbHeaders = {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json"
        };

        // ==========================================
        // TES MANUAL GETXAPI
        // ==========================================

        if (mode === "admin-test-getxapi") {
            const getxApiKey = process.env.GETXAPI_API_KEY;

            let testStatus = "failed";
            let errorMessage = null;
            let tweetCount = 0;

            if (!getxApiKey) {
                errorMessage = "GETXAPI_API_KEY belum dipasang";
            } else {
                try {
                    const params = new URLSearchParams({
                        q: "memecoin",
                        product: "Latest"
                    });

                    const response = await fetch(
                        "https://api.getxapi.com/twitter/tweet/advanced_search?" +
                        params.toString(),
                        {
                            method: "GET",
                            headers: {
                                Authorization: `Bearer ${getxApiKey}`,
                                Accept: "application/json"
                            }
                        }
                    );

                    const responseText = await response.text();

                    let data;

                    try {
                        data = JSON.parse(responseText);
                    } catch {
                        throw new Error(
                            `Respons bukan JSON: HTTP ${response.status}`
                        );
                    }

                    if (!response.ok) {
                        throw new Error(
                            data.message ||
                            data.error ||
                            `GetXAPI HTTP ${response.status}`
                        );
                    }

                    if (!Array.isArray(data.tweets)) {
                        throw new Error(
                            "Format respons GetXAPI tidak dikenali"
                        );
                    }

                    tweetCount = data.tweets.length;
                    testStatus = "success";

                } catch (error) {
                    errorMessage = error.message;
                }
            }

            const createdAt = new Date().toISOString();

            // Catat hasil tes penggunaan API
            const logResponse = await fetch(
                `${baseUrl}/rest/v1/api_usage_logs`,
                {
                    method: "POST",
                    headers: {
                        ...dbHeaders,
                        Prefer: "return=minimal"
                    },
                    body: JSON.stringify([{
                        module: "latest",
                        provider: "GetXAPI",
                        action: "manual_test",
                        status: testStatus,
                        requests_count: getxApiKey ? 1 : 0,
                        error_message: errorMessage,
                        created_at: createdAt
                    }])
                }
            );

            // Perbarui status provider
            const statusResponse = await fetch(
                `${baseUrl}/rest/v1/api_provider_status?on_conflict=module,provider`,
                {
                    method: "POST",
                    headers: {
                        ...dbHeaders,
                        Prefer: "resolution=merge-duplicates,return=minimal"
                    },
                    body: JSON.stringify([{
                        module: "latest",
                        provider: "GetXAPI",
                        role: "backup 3",
                        status: testStatus === "success"
                            ? "active"
                            : "error",
                        last_checked_at: createdAt,
                        last_used_at: getxApiKey ? createdAt : null,
                        last_error: errorMessage
                    }])
                }
            );

            const monitorSaved =
                logResponse.ok && statusResponse.ok;

            if (!monitorSaved) {
                console.error(
                    "GetXAPI monitor save failed:",
                    !logResponse.ok
                        ? await logResponse.text()
                        : await statusResponse.text()
                );
            }

            return res.status(
                testStatus === "success" ? 200 : 502
            ).json({
                success: testStatus === "success",
                provider: "GetXAPI",
                role: "backup 3",
                status: testStatus,
                query: "memecoin",
                tweetCount,
                requestsUsed: getxApiKey ? 1 : 0,
                monitorSaved,
                error: errorMessage
            });
        }

        // ==========================================
        // ADMIN MONITOR - FUNGSI LAMA
        // ==========================================

        const [providerResponse, logsResponse] = await Promise.all([
            fetch(
                `${baseUrl}/rest/v1/api_provider_status?select=*&order=module.asc,provider.asc`,
                { headers: dbHeaders }
            ),
            fetch(
                `${baseUrl}/rest/v1/api_usage_logs?select=*&order=created_at.desc&limit=100`,
                { headers: dbHeaders }
            )
        ]);

        if (!providerResponse.ok) {
            const detail = await providerResponse.text();
            console.error(
                "Provider query failed:",
                providerResponse.status,
                detail
            );
            throw new Error("Provider database query failed");
        }

        if (!logsResponse.ok) {
            const detail = await logsResponse.text();
            console.error(
                "Logs query failed:",
                logsResponse.status,
                detail
            );
            throw new Error("Usage logs database query failed");
        }

        const [providers, logs] = await Promise.all([
            providerResponse.json(),
            logsResponse.json()
        ]);

        return res.status(200).json({
            success: true,
            admin: true,
            providers,
            logs
        });

    } catch (error) {
        console.error("Admin monitor error:", error);

        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
}
