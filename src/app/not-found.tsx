// Every path the app has no page for. The framework's stock 404, same copy and
// layout, in the SyberLabs Midnight theme (globals.css, `.midnight-page`). It is
// the one site-like page Flyspace serves; the canvas at / keeps its own palette.
export default function NotFound() {
    return (
        <div className="midnight-page not-found">
            <title>404: This page could not be found.</title>
            <meta name="theme-color" content="#02070a" />
            <div>
                <h1 className="not-found-code">404</h1>
                <div className="not-found-message">
                    <h2>This page could not be found.</h2>
                </div>
            </div>
        </div>
    );
}
