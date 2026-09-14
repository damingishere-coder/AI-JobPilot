package com.getjobs.application.controller;

import com.getjobs.application.service.LocalActionTokenService;
import com.getjobs.application.service.OpportunityService;
import com.getjobs.application.service.OpportunityWorkbenchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/opportunities")
@RequiredArgsConstructor
public class OpportunityController {
    private final OpportunityService opportunities;
    private final LocalActionTokenService tokens;
    private final OpportunityWorkbenchService workbench;

    @GetMapping public Object list(@RequestParam(required=false) String stage,@RequestParam(required=false) String bucket,@RequestParam(defaultValue="false") boolean archived,
            @RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="20") int size) {
        return bucket==null || bucket.isBlank()?opportunities.list(stage,archived,page,size):workbench.list(bucket,stage,archived,page,size);
    }
    @GetMapping("/{id}") public Object detail(@PathVariable long id) { return opportunities.detail(id); }
    @GetMapping("/{id}/events") public Object events(@PathVariable long id,@RequestParam long before,@RequestParam(defaultValue="50") int size) { return opportunities.eventPage(id,before,size); }
    @PostMapping("/{id}") public ResponseEntity<?> change(@PathVariable long id,@RequestBody OpportunityService.Change request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(opportunities.change(id,request));
    }
    @PostMapping("/{id}/review-observations") public ResponseEntity<?> review(@PathVariable long id,@RequestBody OpportunityService.ObservationReview request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(opportunities.reviewObservations(id,request));
    }
    @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class,java.time.format.DateTimeParseException.class})
    public ResponseEntity<?> invalid(RuntimeException error) { return ResponseEntity.status(409).body(Map.of("success",false,"message",error.getMessage())); }
}
