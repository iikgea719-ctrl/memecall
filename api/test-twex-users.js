
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.TWEXAPI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "TWEXAPI_API_KEY belum tersedia"
        });
    }

    const username = String(
        req.query.username || "blknoiz06"
    ).replace(/^@/, "").trim();

    if (!username) {
        return res.status(400).json({
            success: false,
            error: "Username kosong"
        });
    }

    try {
        const response = await fetch(
            "https://api.twexapi.io/twitter/users",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify([username])
            }
        );

        const result = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                provider: "TwexAPI",
                error: result
            });
        }

        return res.status(200).json({
            success: true,
            provider: "TwexAPI",
            testedUsername: username,
            result
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "TwexAPI",
            error: error.message
        });
    }
}
