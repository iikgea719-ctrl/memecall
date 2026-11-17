
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.XDATAAPI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "XDATAAPI_API_KEY belum ditemukan di Vercel"
        });
    }

    try {
        const params = new URLSearchParams({
            q: "memecoin",
            product: "Latest",
            count: "3"
        });

        const response = await fetch(
            "https://api.xdataapi.io/v1/tweets/search?" +
            params.toString(),
            {
                method: "GET",
                headers: {
                    "x-api-key": apiKey,
                    "Accept": "application/json"
                }
            }
        );

        const result = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                provider: "XDataAPI",
                httpStatus: response.status,
                error:
                    result.error?.message ||
                    result.message ||
                    "XDataAPI request gagal",
                code: result.error?.code || null,
                requestId: result.request_id || null
            });
        }

        if (!Array.isArray(result.data)) {
            return res.status(502).json({
                success: false,
                provider: "XDataAPI",
                error: "Format data dari XDataAPI tidak dikenali"
            });
        }

        return res.status(200).json({
            success: true,
            provider: "XDataAPI",
            totalReturned: result.data.length,
            creditsCharged: result.credits_charged ?? null,
            balanceRemaining: result.balance_remaining ?? null,
            sample: result.data.slice(0, 2).map(tweet => ({
                id: tweet.id,
                text: tweet.text,
                created_at: tweet.created_at,
                author: {
                    name: tweet.author?.name || null,
                    handle: tweet.author?.handle || null,
                    avatar_url: tweet.author?.avatar_url || null
                }
            }))
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "XDataAPI",
            error: error.message
        });
    }
}
