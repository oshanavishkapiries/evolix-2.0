import ReactDOM from "react-dom";

/** Server component: React hoists the preconnect hint into <head>. */
export function TmdbPreconnect() {
  ReactDOM.preconnect("https://image.tmdb.org");
  return null;
}
