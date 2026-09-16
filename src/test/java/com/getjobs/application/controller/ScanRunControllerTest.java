package com.getjobs.application.controller;

import com.getjobs.application.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ScanRunControllerTest {
    @Test void writesRequireTokenAndReadsRequireCurrentProfile() throws Exception {
        var runs=mock(ScanRunService.class);var profiles=mock(ProfileService.class);var tokens=new LocalActionTokenService();
        when(profiles.getCurrentProfileIdOrNull()).thenReturn(4L);
        var mvc=MockMvcBuilders.standaloneSetup(new ScanRunController(runs,profiles,tokens)).build();
        mvc.perform(post("/api/scan-runs?platform=boss&profileId=4").contentType("application/json").content("{\"runId\":\"r1\"}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/scan-runs?platform=boss&profileId=5")).andExpect(status().isConflict());
        mvc.perform(post("/api/scan-runs/r1/commands?platform=boss&profileId=4").header("X-Local-Action-Token",tokens.issueToken()).contentType("application/json").content("{\"kind\":\"STOP\",\"id\":\"c1\"}")).andExpect(status().isOk());
        verify(runs).command("boss",4,"r1","STOP","c1");
        verify(runs,never()).register(anyString(),anyLong(),anyString());
    }
}
