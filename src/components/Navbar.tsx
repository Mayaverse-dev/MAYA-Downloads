import Link from 'next/link';

export default function Navbar() {
    return (
        <nav className="border-b border-brand-gray/50 bg-black/80 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <Link href="/" className="flex items-center group">
                        <span className="text-2xl font-bold tracking-tighter text-brand-red group-hover:drop-shadow-[0_0_8px_rgba(255,0,0,0.8)] transition-all">
                            MAYA
                        </span>
                        <span className="ml-2 text-xs uppercase tracking-[0.3em] font-mono text-gray-500 group-hover:text-gray-300 transition-colors">
                            Downloads
                        </span>
                    </Link>
                    <div className="flex items-center space-x-4">
                        <Link
                            href="https://entermaya.com"
                            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-brand-red transition-colors border border-transparent hover:border-brand-red/30 rounded-full"
                        >
                            Main Site
                        </Link>
                    </div>
                </div>
            </div>
        </nav>
    );
}
