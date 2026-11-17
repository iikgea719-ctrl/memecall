
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

    const usernames = String(
        req.query.usernames || "blknoiz06,soljakey,0xbreadguy,0xcygaar,0xwave"
    )
        .split(",")
        .map(name => name.replace(/^@/, "").trim())
        .filter(Boolean)
        .slice(0, 5);

    if (!usernames.length) {
        return res.status(400).json({
            success: false,
            error: "Tidak ada username"
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
                body: JSON.stringify(usernames)
            }
        );

        const result = await response.json();

        return res.status(response.ok ? 200 : response.status).json({
            success: response.ok,
            provider: "TwexAPI",
            requestedCount: usernames.length,
            testedUsernames: usernames,
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
