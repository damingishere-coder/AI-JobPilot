package com.getjobs.application.opportunity;

/** Recruiting progress, deliberately independent from delivery/AI task status. */
public enum OpportunityStage {
    DISCOVERED, SHORTLISTED, APPLIED, RECRUITER_REPLIED, CHATTING, PHONE_SCREEN,
    INTERVIEW, OFFER, REJECTED, WITHDRAWN;

    public boolean terminal() { return this == OFFER || this == REJECTED || this == WITHDRAWN; }

    /** Late platform observations may advance progress but never undo newer facts. */
    public OpportunityStage observe(OpportunityStage observation) {
        if (terminal() || observation == null || observation.terminal()) return this;
        return observation.ordinal() > ordinal() ? observation : this;
    }

    public OpportunityStage applicationResult(String status, boolean existingContact) {
        return "CONFIRMED".equals(status) && !existingContact ? observe(APPLIED) : this;
    }

    /** Moving backwards or reopening a terminal outcome must be an explicit correction. */
    public OpportunityStage userChange(OpportunityStage next, boolean correction) {
        if (next == null) throw new IllegalArgumentException("请选择求职阶段");
        if (next == this) return this;
        if ((terminal() || next.ordinal() < ordinal()) && !correction)
            throw new IllegalArgumentException("更改已有结果或回退阶段时，请明确记录更正原因");
        return next;
    }
}
