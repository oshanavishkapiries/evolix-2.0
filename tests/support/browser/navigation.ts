export const usePathname = () => new URLSearchParams(location.search).has('admin') ? '/admin/support' : '/support';
export const useRouter = () => ({ push: (url: string) => location.assign(url) });
