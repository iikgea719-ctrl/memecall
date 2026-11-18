
export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    if (req.query.mode !== "admin-monitor") {
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

        // Verifikasi token melalui Supabase Auth
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

        // Hanya User ID admin yang diizinkan
        if (user.id !== adminUserId) {
            return res.status(403).json({
                success: false,
                error: "Admin access only"
            });
        }

        const dbHeaders = {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`
        };

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
    console.error("Provider query failed:", providerResponse.status, detail);
    throw new Error("Provider database query failed");
}

if (!logsResponse.ok) {
    const detail = await logsResponse.text();
    console.error("Logs query failed:", logsResponse.status, detail);
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
