package com.getjobs.application.service;

/** Bounded indices for in-memory pagination, including pages beyond the result set. */
final class PageWindow {
    private PageWindow() {}

    static int start(int page, int size, int total) {
        long offset = Math.multiplyExact(Math.max(0L, (long) page - 1L), Math.max(1L, (long) size));
        return (int) Math.min(Math.max(0, total), offset);
    }

    static int end(int from, int size, int total) {
        return Math.addExact(from, Math.min(Math.max(0, size), total - from));
    }
}
