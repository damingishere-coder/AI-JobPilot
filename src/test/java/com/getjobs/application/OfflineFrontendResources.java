package com.getjobs.application;

import com.microsoft.playwright.Route;
import java.net.URI;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Serves built production UI without touching an installed frontend or production port. */
final class OfflineFrontendResources {
    private static final Path ROOT = Path.of("front/out").toAbsolutePath().normalize();

    private OfflineFrontendResources() {}

    static void serve(Route route, int port) {
        try {
            if (!Files.isRegularFile(ROOT.resolve("boss/analysis.html"))) {
                throw new IllegalStateException("Missing built Next.js UI. Run pnpm --dir front build before browserRegressionTest.");
            }
            String name = URI.create(route.request().url()).getPath().substring(1);
            if (name.isEmpty()) name = "index.html";
            Path file = ROOT.resolve(name).normalize();
            if (!file.startsWith(ROOT)) {
                route.abort();
                return;
            }
            if (!Files.isRegularFile(file) && !name.contains(".")) file = ROOT.resolve(name + ".html").normalize();
            if (!Files.isRegularFile(file)) {
                route.fulfill(new Route.FulfillOptions().setStatus(404).setBody("Fixture asset not found"));
                return;
            }
            String extension = file.getFileName().toString();
            String type = extension.endsWith(".html") ? "text/html; charset=utf-8"
                : extension.endsWith(".js") ? "application/javascript; charset=utf-8"
                : extension.endsWith(".css") ? "text/css; charset=utf-8"
                : extension.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
            var options = new Route.FulfillOptions().setContentType(type);
            // Adapt only allowed loopback origins in this test response. Source/build artifacts stay unchanged.
            if (extension.endsWith(".html") || extension.endsWith(".js")) {
                options.setBody(Files.readString(file)
                    .replace("http://localhost:6866", "http://localhost:" + port)
                    .replace("http://127.0.0.1:6866", "http://127.0.0.1:" + port));
            } else {
                options.setBodyBytes(Files.readAllBytes(file));
            }
            route.fulfill(options);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read built frontend fixture", e);
        }
    }
}
