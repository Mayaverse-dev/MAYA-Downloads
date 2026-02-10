'use client';

import { motion } from 'framer-motion';
import { Download, ExternalLink } from 'lucide-react';
import { DownloadItem } from '@/lib/types';
import Image from 'next/image';

interface DownloadCardProps {
    item: DownloadItem;
}

export default function DownloadCard({ item }: DownloadCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            whileHover={{ y: -5 }}
            className="group relative bg-[#0a0a0a] border border-brand-gray/50 rounded-xl overflow-hidden hover:border-brand-red/50 transition-all duration-300"
        >
            <div className="relative h-48 w-full overflow-hidden">
                <Image
                    src={item.imageUrl}
                    alt={item.title}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
                <div className="absolute top-3 left-3">
                    <span className="px-2 py-1 text-[10px] uppercase tracking-widest font-mono bg-brand-red/90 text-white rounded">
                        {item.category}
                    </span>
                </div>
            </div>

            <div className="p-5">
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-brand-red transition-colors">
                    {item.title}
                </h3>
                <p className="text-gray-400 text-sm line-clamp-2 mb-6">
                    {item.description}
                </p>

                <div className="flex gap-3">
                    <a
                        href={item.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 bg-white text-black font-bold py-2 rounded-lg hover:bg-brand-red hover:text-white transition-all duration-300 active:scale-95"
                    >
                        <Download size={18} />
                        <span>Download</span>
                    </a>
                </div>
            </div>

            {/* Decorative red glow on hover */}
            <div className="absolute -inset-px bg-brand-red/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </motion.div>
    );
}
