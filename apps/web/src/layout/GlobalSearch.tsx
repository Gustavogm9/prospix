'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Building, User, UserCircle } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

interface SearchResult {
  kind: 'tenant' | 'user' | 'lead';
  id: string;
  label: string;
  sub: string;
  href: string;
}

interface SearchResponse {
  tenants: SearchResult[];
  users: SearchResult[];
  leads: SearchResult[];
}

const KIND_ICON: Record<SearchResult['kind'], typeof Building> = {
  tenant: Building,
  user: User,
  lead: UserCircle,
};

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  tenant: 'Tenant',
  user: 'Usuário',
  lead: 'Lead',
};

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await adminApiClient.get(`/admin/search?q=${encodeURIComponent(term)}&limit=8`);
        setResults(response.data?.data ?? null);
      } catch (err: unknown) {
        if (!(err instanceof AxiosError)) console.error(err);
        setResults(null);
      } finally {
        setIsLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const flatResults: SearchResult[] = results
    ? [...results.tenants, ...results.users, ...results.leads]
    : [];

  const handleSelect = (href: string) => {
    // Prefix href with /admin if not already prefixed
    const adminHref = href.startsWith('/admin') ? href : `/admin${href}`;
    router.push(adminHref);
    setQuery('');
    setResults(null);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          placeholder="Buscar tenants, usuários, leads… (Ctrl+K)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          className="w-full bg-white border border-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-text placeholder-text-secondary focus:border-border-strong focus:outline-none"
          aria-label="Busca universal"
        />
        {isLoading && (
          <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary animate-spin" aria-hidden />
        )}
      </div>

      {isOpen && query.trim().length >= 2 && (
        <div className="absolute top-full mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-[400px] overflow-y-auto z-50">
          {isLoading ? (
            <div className="py-6 text-center text-xs text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" aria-hidden /> Buscando...
            </div>
          ) : flatResults.length === 0 ? (
            <div className="py-6 text-center text-xs text-text-secondary">
              Nenhum resultado para &quot;{query}&quot;.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {(['tenant', 'user', 'lead'] as const).map((kind) => {
                const list = results?.[`${kind}s` as 'tenants' | 'users' | 'leads'] ?? [];
                if (list.length === 0) return null;
                const Icon = KIND_ICON[kind];
                return (
                  <div key={kind} className="p-1">
                    <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                      {KIND_LABEL[kind]} ({list.length})
                    </div>
                    {list.map((r) => (
                      <button
                        key={`${r.kind}-${r.id}`}
                        type="button"
                        onClick={() => handleSelect(r.href)}
                        className="w-full text-left px-2 py-2 rounded hover:bg-surface-sunken/60 flex items-start gap-2 transition-colors"
                      >
                        <Icon className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-text truncate">{r.label}</div>
                          <div className="text-[10px] text-text-secondary truncate">{r.sub}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GlobalSearch;
