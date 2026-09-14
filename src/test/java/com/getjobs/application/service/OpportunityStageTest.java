package com.getjobs.application.service;

import com.getjobs.application.opportunity.OpportunityStage;
import org.junit.jupiter.api.Test;
import static com.getjobs.application.opportunity.OpportunityStage.*;
import static org.assertj.core.api.Assertions.*;

class OpportunityStageTest {
    @Test void deliveryUnknownFailureAndExistingContactDoNotBecomeAppliedOrRejected() {
        for(String status:new String[]{"REQUESTED","FAILED","UNKNOWN"})
            assertThat(DISCOVERED.applicationResult(status,false)).isEqualTo(DISCOVERED);
        assertThat(DISCOVERED.applicationResult("CONFIRMED",true)).isEqualTo(DISCOVERED);
        assertThat(DISCOVERED.applicationResult("CONFIRMED",false)).isEqualTo(APPLIED);
    }
    @Test void delayedObservationsCannotDowngradeInterviewsOrOverrideOutcomes() {
        assertThat(INTERVIEW.applicationResult("CONFIRMED",false)).isEqualTo(INTERVIEW);
        for(OpportunityStage stage:new OpportunityStage[]{OFFER,REJECTED,WITHDRAWN})
            assertThat(stage.observe(RECRUITER_REPLIED)).isEqualTo(stage);
        assertThat(CHATTING.observe(OFFER)).isEqualTo(CHATTING);
    }
    @Test void userCanCorrectAnOutcomeButMustIdentifyItAsCorrection() {
        assertThatThrownBy(()->OFFER.userChange(INTERVIEW,false)).hasMessageContaining("更正");
        assertThat(OFFER.userChange(INTERVIEW,true)).isEqualTo(INTERVIEW);
        assertThat(INTERVIEW.userChange(REJECTED,false)).isEqualTo(REJECTED);
    }
}
