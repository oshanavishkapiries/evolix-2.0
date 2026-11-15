import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ featured: vi.fn(), latest: vi.fn(), genres: vi.fn(), browse: vi.fn(), user: vi.fn(), access: vi.fn(), resume: vi.fn(), bookmarks: vi.fn(), logo: vi.fn() }));
vi.mock('@/lib/viewer/catalog', () => ({ listFeatured: state.featured, listLatest: state.latest, listGenres: state.genres, browse: state.browse, featuredLogo: state.logo }));
vi.mock('@/lib/viewer/user', () => ({ currentUserId: state.user }));
vi.mock('@/lib/viewer/access', () => ({ canWatch: state.access }));
vi.mock('@/lib/viewer/library', () => ({ continueWatching: state.resume, listBookmarks: state.bookmarks }));
vi.mock('@/app/(viewer)/_components/approval-notice', () => ({ ApprovalNotice: () => null }));
vi.mock('@/app/(viewer)/_components/continue-row', () => ({ ContinueRow: () => null }));
vi.mock('@/app/(viewer)/_components/hub-row', () => ({ HubRow: () => null }));
vi.mock('@/app/(viewer)/_components/media-card', () => ({ MediaCard: () => null }));
vi.mock('@/app/(viewer)/_components/scroll-row', () => ({ ScrollRow: () => null }));
import { HomeApproval, HomeBrowseLink, HomeContinue, HomeEmpty, HomeFeatured, HomeGenres, HomeLatest, HomeMyList } from '@/app/(viewer)/_components/home-rows';

const card = { kind: 'movie' as const, id: 'tmdb-1', title: 'Title', date: null, posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg', rating: null };
const never = new Promise<never>(() => {});
beforeEach(() => {
  vi.clearAllMocks();
  state.featured.mockResolvedValue([card]);
  state.latest.mockResolvedValue([card]);
  state.genres.mockResolvedValue(['Action', 'Comedy']);
  state.user.mockResolvedValue('viewer');
  state.access.mockResolvedValue(false);
  state.resume.mockResolvedValue([]);
  state.bookmarks.mockResolvedValue([card]);
  state.logo.mockReturnValue(never);
});

describe('P2-C independent home rows', () => {
  it('renders featured without waiting for latest rows, auth, or logos', async () => {
    state.latest.mockReturnValue(never);
    state.user.mockReturnValue(never);
    expect(await HomeFeatured()).not.toBeNull();
    expect(state.user).not.toHaveBeenCalled();
    expect(state.logo).not.toHaveBeenCalled();
  });

  it('renders a latest row without waiting for featured or auth', async () => {
    state.featured.mockReturnValue(never);
    state.user.mockReturnValue(never);
    expect(await HomeLatest({ kind: 'movie' })).not.toBeNull();
    expect(state.user).not.toHaveBeenCalled();
  });

  it('creates genre boundaries without waiting for the other public rows', async () => {
    state.featured.mockReturnValue(never);
    state.latest.mockReturnValue(never);
    expect(await HomeGenres()).toHaveLength(2);
    expect(state.user).not.toHaveBeenCalled();
  });

  it('preserves the pending approval banner while retaining personal rows', async () => {
    expect(await HomeApproval()).not.toBeNull();
    expect(await HomeContinue()).not.toBeNull();
    expect(await HomeMyList()).not.toBeNull();
    expect(state.access).toHaveBeenCalledWith('viewer');
    expect(state.resume).toHaveBeenCalledWith('viewer');
    expect(state.bookmarks).toHaveBeenCalledWith('viewer', 20);
  });

  it('preserves the empty-library gate for personal content and the browse link', async () => {
    state.featured.mockResolvedValue([]);
    state.latest.mockResolvedValue([]);
    expect(await HomeEmpty()).not.toBeNull();
    expect(await HomeApproval()).toBeNull();
    expect(await HomeContinue()).toBeNull();
    expect(await HomeMyList()).toBeNull();
    expect(await HomeBrowseLink()).toBeNull();
  });

  it('omits the approval banner for approved viewers and personal rows without a user', async () => {
    state.access.mockResolvedValue(true);
    expect(await HomeApproval()).toBeNull();
    state.user.mockResolvedValue(null);
    expect(await HomeContinue()).toBeNull();
    expect(await HomeMyList()).toBeNull();
    expect(state.resume).not.toHaveBeenCalled();
    expect(state.bookmarks).not.toHaveBeenCalled();
  });
});
