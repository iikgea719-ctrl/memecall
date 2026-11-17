
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.TWITTRAPI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "TWITTRAPI_API_KEY is not configured"
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

    try {
        const url = new URL(
            `https://api.twittrapi.com/user/-1/tweets`
        );

        url.searchParams.set("username", username);
        url.searchParams.set("count", "5");
        url.searchParams.set("format", "simple");

        const response = await fetch(url, {
            headers: {
                "X-API-KEY": apiKey
            }
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: "TwittrAPI request failed",
                details: data
            });
        }

        return res.status(200).json({
            success: true,
            source: "TwittrAPI",
            username,
            total: data.data?.length || 0,
            tweets: data.data || []
        });

    } catch (error) {
        return res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
}
