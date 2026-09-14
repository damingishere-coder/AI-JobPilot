package com.getjobs.application.controller;

import com.getjobs.application.service.OpportunityWorkbenchService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class OpportunityWorkbenchController {
    private final OpportunityWorkbenchService workbench;
    @GetMapping("/api/workbench") public Object summary() { return workbench.summary(); }
}
