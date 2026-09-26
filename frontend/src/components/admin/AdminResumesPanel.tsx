import { useCallback, useEffect, useState } from 'react';
import { deleteAdminResume, fetchAdminResume, fetchAdminResumes } from '../../lib/api';
import type { AdminResumeDetail, AdminResumeRow } from '../../lib/api';
import { buttonClass, dangerButtonClass, dateText, fileSize } from './adminShared';
import { PanelMessage, Pager, SearchBox } from './adminUi';
import type { AdminPanelProps } from './adminShared';

export default function AdminResumesPanel({ getToken, notify, initialSearch = '' }: AdminPanelProps & { initialSearch?: string }) {
  const [query, setQuery] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ resumes: AdminResumeRow[]; has_more: boolean; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AdminResumeDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminResumes(await getToken(), { q: search, offset }));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load resumes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [getToken, notify, search, offset]);

  useEffect(() => {
    // Loading data from the server; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const view = async (resume: AdminResumeRow) => {
    setBusyId(resume.id);
    try {
      setViewing((await fetchAdminResume(await getToken(), resume.id)).resume);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to open the resume.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (resume: AdminResumeRow) => {
    const owner = resume.owner?.email || 'this candidate';
    if (!window.confirm(`Permanently delete "${resume.original_filename || 'resume'}" from ${owner}? The file and its parsed text will be removed.`)) return;
    setBusyId(resume.id);
    try {
      await deleteAdminResume(await getToken(), resume.id);
      notify('Resume deleted.', 'success');
      if (viewing?.id === resume.id) setViewing(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to delete the resume.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resumes = data?.resumes || [];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bdr px-4 py-3">
        <p className="text-sm text-soft-text">Uploaded candidate resumes, newest first.</p>
        <SearchBox value={query} onChange={setQuery} onSubmit={() => { setSearch(query.trim()); setOffset(0); }} placeholder="Search candidate name or email" />
      </div>
      {loading && !data ? <PanelMessage>Loading resumes...</PanelMessage> : resumes.length === 0 ? <PanelMessage>No resumes found.</PanelMessage> : (
        <div className="overflow-x-auto border-t border-bdr">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg text-xs uppercase text-soft-text">
              <tr>
                <th className="px-4 py-3 font-extrabold">Candidate</th>
                <th className="px-4 py-3 font-extrabold">File</th>
                <th className="px-4 py-3 font-extrabold">Size</th>
                <th className="px-4 py-3 font-extrabold">Uploaded</th>
                <th className="px-4 py-3 font-extrabold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {resumes.map((resume) => (
                <tr key={resume.id} className="bg-card align-top">
                  <td className="px-4 py-3">
                    <div className="font-bold text-dark">{resume.owner?.name || 'Unknown user'}</div>
                    <div className="text-xs text-soft-text">{resume.owner?.email}</div>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-mid">
                    <div className="truncate">{resume.original_filename || 'Untitled resume'}</div>
                    {!resume.has_file && <div className="text-xs text-soft-text">Parsed text only</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-mid">{fileSize(resume.file_size_bytes)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-mid">{dateText(resume.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button className={buttonClass} type="button" disabled={busyId === resume.id} onClick={() => void view(resume)}>View</button>
                      <button className={dangerButtonClass} type="button" disabled={busyId === resume.id} onClick={() => void remove(resume)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} limit={data.limit} hasMore={data.has_more} onPage={setOffset} />}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewing(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-card shadow-xl" role="dialog" aria-modal="true" aria-label="Resume" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-bdr px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-extrabold">{viewing.original_filename || 'Resume'}</h3>
                <p className="text-xs text-soft-text">{viewing.owner?.name} · {viewing.owner?.email} · {dateText(viewing.created_at)}</p>
              </div>
              <button className={buttonClass} type="button" onClick={() => setViewing(null)}>Close</button>
            </div>
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {viewing.download_url
                ? <a className="rounded-lg bg-forest px-3 py-2 text-sm font-bold text-white hover:opacity-90" href={viewing.download_url} target="_blank" rel="noreferrer">Open original file</a>
                : <span className="text-xs text-soft-text">The original file is not stored; only the parsed text is available.</span>}
              <button className={dangerButtonClass} type="button" onClick={() => void remove(viewing)}>Delete resume</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="mb-1 text-xs font-bold uppercase text-soft-text">Parsed text</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-bdr bg-bg p-3 font-sans text-sm text-mid">{viewing.parsed_text || 'No text was extracted from this resume.'}</pre>
              {viewing.parsed_text_truncated && <p className="mt-2 text-xs text-soft-text">Text shortened for display. Open the original file for the full resume.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
