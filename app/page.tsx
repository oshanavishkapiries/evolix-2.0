export default function Home() {
  return (
    <main className="auth card text-center">
      <h1>Evolix</h1>
      <nav aria-label="Main">
        <ul className="flex flex-col gap-2">
          <li><a href="/login" className="block rounded-md bg-indigo-600 px-3 py-2 font-medium text-white no-underline hover:bg-indigo-700 dark:text-white">Log in</a></li>
          <li><a href="/register" className="block rounded-md border border-gray-300 px-3 py-2 font-medium no-underline hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">Register</a></li>
          <li><a href="/dashboard">Dashboard</a></li>
        </ul>
      </nav>
    </main>
  );
}
