
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const twitterKey = process.env.TWITTERAPIS_API_KEY;
    const xdataKey = process.env.XDATAAPI_API_KEY;
    const directXData = req.query.provider === "xdata";
    const query = "memecoin";

    const results = [];

    async function testTwitterAPIs() {
        if (!twitterKey) {
            throw new Error("TwitterAPIS key belum dipasang");
        }

        const params = new URLSearchParams({
            query,
            product: "Latest",
            compact: "1"
        });

        const response = await fetch(
            "https://api.twitterapis.com/twitter/tweet/advanced_search?" +
            params.toString(),
            {
                headers: {
                    Authorization: `Bearer ${twitterKey}`,
                    Accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || `HTTP ${response.status}`
            );
        }

        const tweets = data.tweets || [];

        if (!tweets.length) {
            throw new Error("Tidak ada postingan");
        }

        return tweets.slice(0, 3).map(tweet => ({
            id: tweet.id,
            text: tweet.text || "",
            created_at: tweet.created_at || ""
        }));
    }

    async function testXDataAPI() {
        if (!xdataKey) {
            throw new Error("XDataAPI key belum dipasang");
        }

        const params = new URLSearchParams({
            q: query,
            product: "Latest",
            count: "3"
        });

        const response = await fetch(
            "https://api.xdataapi.io/v1/tweets/search?" +
            params.toString(),
            {
                headers: {
                    "x-api-key": xdataKey,
                    Accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || `HTTP ${response.status}`
            );
        }

        if (!Array.isArray(data.data) || !data.data.length) {
            throw new Error("Tidak ada postingan");
        }

        return data.data.slice(0, 3).map(tweet => ({
            id: tweet.id,
            text: tweet.text || "",
            created_at: tweet.created_at || ""
        }));
    }

    // MODE TES XDATAAPI LANGSUNG
    if (directXData) {
        try {
            const tweets = await testXDataAPI();

            return res.status(200).json({
                success: true,
                mode: "DIRECT XDATAAPI TEST",
                activeSource: "XDataAPI",
                total: tweets.length,
                tweets
            });

        } catch (error) {
            return res.status(200).json({
                success: false,
                mode: "DIRECT XDATAAPI TEST",
                activeSource: null,
                error: error.message
            });
        }
    }

    // MODE BACKUP BERURUTAN
    const providers = [
        {
            name: "TwitterAPIs",
            run: testTwitterAPIs
        },
        {
            name: "XDataAPI",
            run: testXDataAPI
        }
    ];

    for (const provider of providers) {
        try {
            const tweets = await provider.run();

            results.push({
                provider: provider.name,
                status: "SUCCESS",
                total: tweets.length
            });

            return res.status(200).json({
                success: true,
                activeSource: provider.name,
                testedProviders: results,
                tweets
            });

        } catch (error) {
            results.push({
                provider: provider.name,
                status: "FAILED",
                error: error.message
            });
        }
    }

    return res.status(200).json({
        success: false,
        activeSource: null,
        testedProviders: results
    });
}
