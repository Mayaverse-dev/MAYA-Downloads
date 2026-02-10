import { NextRequest, NextResponse } from 'next/server';
import { getDownloads, saveDownloads } from '@/lib/storage';
import { v4 as uuidv4 } from 'uuid';
import { DownloadItem } from '@/lib/types';

function checkAuth(req: NextRequest) {
    const password = req.headers.get('x-admin-password') || req.nextUrl.searchParams.get('pw');
    return password === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const downloads = await getDownloads();
    return NextResponse.json(downloads);
}

export async function POST(req: NextRequest) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await req.json();
    const downloads = await getDownloads();

    const newItem: DownloadItem = {
        ...data,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
    };

    downloads.push(newItem);
    await saveDownloads(downloads);

    return NextResponse.json(newItem);
}

export async function DELETE(req: NextRequest) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await req.json();
    let downloads = await getDownloads();
    downloads = downloads.filter((item) => item.id !== id);
    await saveDownloads(downloads);

    return NextResponse.json({ success: true });
}
