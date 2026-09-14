package com.getjobs.application.controller;

import com.getjobs.application.service.LocalActionTokenService;
import com.getjobs.application.service.OpportunityFeedbackService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/opportunities/{id}")
@RequiredArgsConstructor
public class OpportunityFeedbackController {
    private final OpportunityFeedbackService feedback;
    private final LocalActionTokenService tokens;
    @GetMapping("/conversations") public Object conversations(@PathVariable long id) { return feedback.conversations(id); }
    @GetMapping("/conversations/{conversationId}/messages") public Object messages(@PathVariable long id,@PathVariable long conversationId) { return feedback.messages(id,conversationId); }
    @PostMapping("/conversations") public ResponseEntity<?> link(@PathVariable long id,@RequestBody OpportunityFeedbackService.Link request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(feedback.link(id,request));
    }
    @PostMapping("/feedback") public ResponseEntity<?> feedback(@PathVariable long id,@RequestBody OpportunityFeedbackService.Feedback request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(feedback.feedback(id,request));
    }
    @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class,java.time.format.DateTimeParseException.class})
    public ResponseEntity<?> invalid(RuntimeException error) { return ResponseEntity.status(409).body(Map.of("success",false,"message",error.getMessage())); }
}
