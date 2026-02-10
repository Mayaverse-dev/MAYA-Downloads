import { getDownloads } from '@/lib/storage';
import DownloadCard from '@/components/DownloadCard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const downloads = await getDownloads();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <header className="mb-16 text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-4 uppercase">
          Free <span className="text-brand-red">Assets</span>
        </h1>
        <p className="text-gray-400 max-w-2xl mx-auto text-lg">
          Explore and download official MAYA Narrative universe resources.
          New content added regularly. No login required.
        </p>
      </header>

      {downloads.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {downloads.map((item) => (
            <DownloadCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 border border-dashed border-brand-gray/50 rounded-2xl">
          <p className="text-gray-500 font-mono italic">No downloads available at the moment. Check back soon.</p>
        </div>
      )}
    </div>
  );
}
