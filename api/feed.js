
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.SORSA_API_KEY;

    const query = req.query.q || "memecoin OR solana OR pump.fun";

    const activeSources = [];
    const backupSources = [];

    try {
        // API 1 - SORSA
        if (apiKey) {
            const response = await fetch(
                "https://api.sorsa.io/v3/search-tweets",
                {
                    method: "POST",
                    headers: {
                        "ApiKey": apiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        query,
                        order: "latest"
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();

                activeSources.push({
                    name: "Sorsa",
                    tweets: data.tweets || []
                });
            }
        }

        // API aktif dan backup lainnya
        // akan ditambahkan pada tahap berikutnya.

        const allTweets = activeSources.flatMap(
            source => source.tweets
        );

        // Hapus tweet duplikat
        const uniqueTweets = [
            ...new Map(
                allTweets.map(tweet => [
                    tweet.id,
                    tweet
                ])
            ).values()
        ];

        // Urutkan tweet terbaru
        uniqueTweets.sort((a, b) =>
            new Date(b.created_at) -
            new Date(a.created_at)
        );

        return res.status(200).json({
            success: true,
            activeSources: activeSources.map(s => s.name),
            backupSources,
            total: uniqueTweets.length,
            tweets: uniqueTweets
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "Feed engine error",
            details: error.message
        });
    }
}
