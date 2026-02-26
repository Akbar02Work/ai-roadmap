import { ReactNode } from "react";
import { forbidden, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-admin";
import { AuthError } from "@/lib/auth";

export default async function AdminLayout({
    children,
    params,
}: {
    children: ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;

    try {
        await requireAdmin();
    } catch (err) {
        if (err instanceof AuthError) {
            if (err.status === 401) {
                redirect(`/${locale}/login`);
            }
            if (err.status === 403) {
                forbidden();
            }
        }
        throw err;
    }

    return children;
}
