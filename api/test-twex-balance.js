
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
            error: "TWEXAPI_API_KEY belum ditemukan di Vercel"
        });
    }

    try {
        const response = await fetch(
            "https://api.twexapi.io/balance",
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Accept": "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                provider: "TwexAPI",
                error: data
            });
        }

        return res.status(200).json({
            success: true,
            provider: "TwexAPI",
            balance: data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "TwexAPI",
            error: error.message
        });
    }
}
