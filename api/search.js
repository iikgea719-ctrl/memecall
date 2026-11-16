
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.SORSA_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: "API key belum dipasang" });
    }

    try {
        const query = req.query.q || "memecoin OR solana OR pump.fun";

        const response = await fetch(
            "https://api.sorsa.io/v3/search-tweets",
            {
                method: "POST",
                headers: {
                    "ApiKey": apiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    query: query,
                    order: "latest"
                })
            }
        );

        const data = await response.json();

        return res.status(response.status).json(data);

    } catch (error) {
        return res.status(500).json({
            error: "Gagal mengambil tweet",
            details: error.message
        });
    }
}
