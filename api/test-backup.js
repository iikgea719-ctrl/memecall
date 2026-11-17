
export default async function handler(req, res) {
    const apiKey = process.env.TWITTERAPIS_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "TWITTERAPIS_API_KEY belum ditemukan"
        });
    }

    try {
        const params = new URLSearchParams({
    query: 'memecoin OR "meme coin" OR pump.fun OR solana',
    product: "Latest",
    compact: "1",
    fields: "author.profile_image_url,media.media_url_https,media.type,media.expanded_url"
});

        const response = await fetch(
            "https://api.twitterapis.com/twitter/tweet/advanced_search?" +
            params.toString(),
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`
                }
            }
        );

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            source: "TwitterAPIs",
            total: data.tweets?.length || 0,
            tweets: data.tweets || [],
            error: data.error || null,
            message: data.message || null
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
