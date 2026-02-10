'use client';

import { useState, useEffect } from 'react';
import { DownloadItem } from '@/lib/types';
import { Trash2, Plus, ExternalLink, Shield } from 'lucide-react';

export default function AdminPage() {
    const [password, setPassword] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [newAsset, setNewAsset] = useState({
        title: '',
        description: '',
        category: 'General',
        imageUrl: '',
        downloadUrl: '',
    });

    const fetchDownloads = async (pw: string) => {
        try {
            const res = await fetch(`/api/admin/downloads?pw=${pw}`);
            if (res.ok) {
                const data = await res.json();
                setDownloads(data);
                setIsLoggedIn(true);
                localStorage.setItem('admin_pw', pw);
            } else {
                alert('Invalid Password');
            }
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        const savedPw = localStorage.getItem('admin_pw');
        if (savedPw) {
            setPassword(savedPw);
            fetchDownloads(savedPw);
        }
    }, []);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        fetchDownloads(password);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/admin/downloads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-password': password,
                },
                body: JSON.stringify(newAsset),
            });
            if (res.ok) {
                await fetchDownloads(password);
                setNewAsset({ title: '', description: '', category: 'General', imageUrl: '', downloadUrl: '' });
            }
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure?')) return;
        try {
            const res = await fetch('/api/admin/downloads', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-password': password,
                },
                body: JSON.stringify({ id }),
            });
            if (res.ok) fetchDownloads(password);
        } catch (err) {
            console.error(err);
        }
    };

    if (!isLoggedIn) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh]">
                <div className="bg-[#0a0a0a] p-8 rounded-2xl border border-brand-gray/50 w-full max-w-md">
                    <div className="flex justify-center mb-6">
                        <Shield className="text-brand-red w-12 h-12" />
                    </div>
                    <h1 className="text-2xl font-bold text-center mb-6">MAYA Admin Access</h1>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <input
                            type="password"
                            placeholder="Enter Admin Password"
                            className="w-full bg-black border border-brand-gray/50 rounded-lg p-3 text-white focus:border-brand-red outline-none transition-colors"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <button className="w-full bg-brand-red text-white py-3 rounded-lg font-bold hover:bg-red-700 transition-colors">
                            Access Dashboard
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-6 md:p-12">
            <div className="flex justify-between items-center mb-12">
                <h1 className="text-3xl font-black uppercase">Dashboard</h1>
                <button
                    onClick={() => { setIsLoggedIn(false); localStorage.removeItem('admin_pw'); }}
                    className="text-gray-500 hover:text-white transition-colors underline text-sm"
                >
                    Logout
                </button>
            </div>

            <div className="grid md:grid-cols-3 gap-12">
                {/* Form */}
                <div className="md:col-span-1">
                    <div className="bg-[#0a0a0a] p-6 rounded-xl border border-brand-gray/50 sticky top-24">
                        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                            <Plus size={20} className="text-brand-red" />
                            Add New Asset
                        </h2>
                        <form onSubmit={handleAdd} className="space-y-4">
                            <div>
                                <label className="text-xs uppercase text-gray-500 font-bold mb-1 block">Title</label>
                                <input
                                    required
                                    className="w-full bg-black border border-brand-gray/50 rounded p-2 text-white text-sm"
                                    value={newAsset.title}
                                    onChange={(e) => setNewAsset({ ...newAsset, title: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs uppercase text-gray-500 font-bold mb-1 block">Description</label>
                                <textarea
                                    required
                                    className="w-full bg-black border border-brand-gray/50 rounded p-2 text-white text-sm h-20"
                                    value={newAsset.description}
                                    onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs uppercase text-gray-500 font-bold mb-1 block">Category</label>
                                <input
                                    required
                                    className="w-full bg-black border border-brand-gray/50 rounded p-2 text-white text-sm"
                                    value={newAsset.category}
                                    onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs uppercase text-gray-500 font-bold mb-1 block">Image URL</label>
                                <input
                                    required
                                    className="w-full bg-black border border-brand-gray/50 rounded p-2 text-white text-sm"
                                    value={newAsset.imageUrl}
                                    onChange={(e) => setNewAsset({ ...newAsset, imageUrl: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs uppercase text-gray-500 font-bold mb-1 block">Download URL</label>
                                <input
                                    required
                                    className="w-full bg-black border border-brand-gray/50 rounded p-2 text-white text-sm"
                                    value={newAsset.downloadUrl}
                                    onChange={(e) => setNewAsset({ ...newAsset, downloadUrl: e.target.value })}
                                />
                            </div>
                            <button
                                disabled={loading}
                                className="w-full bg-white text-black py-3 rounded font-bold hover:bg-brand-red hover:text-white transition-all disabled:opacity-50"
                            >
                                {loading ? 'Adding...' : 'Add to Collection'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* List */}
                <div className="md:col-span-2">
                    <h2 className="text-xl font-bold mb-6">Current Assets ({downloads.length})</h2>
                    <div className="space-y-4">
                        {downloads.map((item) => (
                            <div key={item.id} className="bg-[#0a0a0a] border border-brand-gray/50 p-4 rounded-lg flex items-center gap-4 group">
                                <div className="w-16 h-16 relative flex-shrink-0">
                                    <img src={item.imageUrl} className="w-full h-full object-cover rounded" alt="" />
                                </div>
                                <div className="flex-grow min-w-0">
                                    <h3 className="font-bold truncate">{item.title}</h3>
                                    <p className="text-xs text-gray-500 truncate">{item.category}</p>
                                </div>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <a href={item.downloadUrl} target="_blank" className="p-2 hover:text-brand-red">
                                        <ExternalLink size={18} />
                                    </a>
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:text-brand-red">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
