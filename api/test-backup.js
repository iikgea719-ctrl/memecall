
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const twitterKey = process.env.TWITTERAPIS_API_KEY;
    const xdataKey = process.env.XDATAAPI_API_KEY;

    const query = "memecoin";

    const results = [];
    let activeSource = null;

    async function testTwitterAPIs() {
        if (!twitterKey) {
            throw new Error("TwitterAPIs key belum dipasang");
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

            activeSource = provider.name;

            return res.status(200).json({
                success: true,
                activeSource,
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
