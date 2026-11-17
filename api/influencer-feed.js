
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({
            success: false,
            error: "Supabase environment variables are missing"
        });
    }

    try {
        const baseUrl = supabaseUrl.replace(/\/$/, "");

        const headers = {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
        };

        // Ambil postingan Influencer
        const postsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_posts?select=id,post_id,username,post_text,media,post_url,posted_at,saved_at&order=posted_at.desc&limit=100`,
            { headers }
        );

        const posts = await postsResponse.json();

        if (!postsResponse.ok) {
            console.error("Posts error:", posts);

            return res.status(500).json({
                success: false,
                error: "Failed to load influencer posts"
            });
        }

        // Ambil data akun dan foto profil
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?select=username,display_name,profile_image_url`,
            { headers }
        );

        const accounts = await accountsResponse.json();

        if (!accountsResponse.ok) {
            console.error("Accounts error:", accounts);

            return res.status(500).json({
                success: false,
                error: "Failed to load influencer accounts"
            });
        }

        // Gabungkan postingan dengan data profil
        const accountMap = new Map(
            accounts.map(account => [
                String(account.username).toLowerCase(),
                account
            ])
        );

        const combinedPosts = posts.map(post => {
            const account = accountMap.get(
                String(post.username).toLowerCase()
            );

            return {
                ...post,
                display_name: account?.display_name || post.username,
                profile_image_url: account?.profile_image_url || null
            };
        });

        return res.status(200).json({
            success: true,
            source: "Supabase",
            total: combinedPosts.length,
            posts: combinedPosts
        });

    } catch (error) {
        console.error("Influencer feed error:", error);

        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
}
