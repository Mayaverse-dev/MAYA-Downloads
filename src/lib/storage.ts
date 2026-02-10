import fs from 'fs/promises';
import path from 'path';
import { DownloadItem } from './types';

const DATA_FILE = path.join(process.cwd(), 'data', 'downloads.json');

export async function getDownloads(): Promise<DownloadItem[]> {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading downloads:', error);
        return [];
    }
}

export async function saveDownloads(downloads: DownloadItem[]): Promise<void> {
    await fs.writeFile(DATA_FILE, JSON.stringify(downloads, null, 2), 'utf-8');
}
