
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.WEIR_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            provider: "Weir",
            error: "WEIR_API_KEY belum tersedia"
        });
    }

    try {
        const response = await fetch(
            "https://api.weirapp.io/v1/whoami",
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Accept": "application/json"
                }
            }
        );

        const result = await response.json();

        return res.status(response.ok ? 200 : response.status).json({
            success: response.ok,
            provider: "Weir",
            test: "Authentication",
            result
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "Weir",
            error: error.message
        });
    }
}
