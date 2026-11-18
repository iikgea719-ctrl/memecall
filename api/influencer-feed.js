
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

        const limit = 100;

        // Cursor untuk mengambil postingan yang lebih lama
        const before = req.query?.before;
        const beforeId = req.query?.beforeId;

        const postsUrl = new URL(
            `${baseUrl}/rest/v1/influencer_posts`
        );

        postsUrl.searchParams.set(
            "select",
            "id,post_id,username,post_text,media,post_url,posted_at,saved_at"
        );

        postsUrl.searchParams.set(
            "order",
            "posted_at.desc,id.desc"
        );

        postsUrl.searchParams.set("limit", String(limit));

        // Jika ada cursor, ambil postingan setelah posisi terakhir
        if (before && beforeId) {
            const timestamp = new Date(before);

            if (
                Number.isNaN(timestamp.getTime()) ||
                !/^\d+$/.test(String(beforeId))
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid pagination cursor"
                });
            }

            const safeDate = timestamp.toISOString();

            postsUrl.searchParams.set(
                "or",
                `(posted_at.lt.${safeDate},and(posted_at.eq.${safeDate},id.lt.${beforeId}))`
            );
        }

        // Ambil arsip postingan
        const postsResponse = await fetch(postsUrl, {
            headers
        });

        const posts = await postsResponse.json();

        if (!postsResponse.ok) {
            console.error("Posts error:", posts);

            return res.status(500).json({
                success: false,
                error: "Failed to load influencer posts"
            });
        }

        // Ambil hanya akun yang masih aktif
        const accountsResponse = await fetch(
            `${baseUrl}/rest/v1/influencer_accounts?is_active=eq.true&select=username,display_name,profile_image_url`,
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

        const accountMap = new Map(
            accounts.map(account => [
                String(account.username).toLowerCase(),
                account
            ])
        );

        // Gabungkan hanya postingan milik akun aktif
        const combinedPosts = posts
            .filter(post =>
                accountMap.has(
                    String(post.username).toLowerCase()
                )
            )
            .map(post => {
                const account = accountMap.get(
                    String(post.username).toLowerCase()
                );

                return {
                    ...post,
                    display_name:
                        account.display_name || post.username,
                    profile_image_url:
                        account.profile_image_url || null
                };
            });

        // Cursor menggunakan baris terakhir dari data Supabase,
        // termasuk jika postingan tersebut milik akun nonaktif.
        const lastPost = posts.length > 0
            ? posts[posts.length - 1]
            : null;

        return res.status(200).json({
            success: true,
            source: "Supabase",
            total: combinedPosts.length,
            posts: combinedPosts,
            hasMore: posts.length === limit,
            nextCursor: lastPost
                ? {
                    before: lastPost.posted_at,
                    beforeId: lastPost.id
                }
                : null
        });

    } catch (error) {
        console.error("Influencer feed error:", error);

        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
}
