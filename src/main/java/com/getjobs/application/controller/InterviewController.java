package com.getjobs.application.controller;

import com.getjobs.application.service.InterviewService;
import com.getjobs.application.service.LocalActionTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequiredArgsConstructor
public class InterviewController {
    private final InterviewService interviews;
    private final LocalActionTokenService tokens;
    @GetMapping("/api/interviews") public Object list(@RequestParam(required=false) Long opportunityId,@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="20") int size) {
        return interviews.list(opportunityId,page,size);
    }
    @PostMapping("/api/opportunities/{id}/interviews") public ResponseEntity<?> save(@PathVariable long id,@RequestBody InterviewService.Save request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(interviews.save(id,request));
    }
    @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class,java.time.DateTimeException.class})
    public ResponseEntity<?> invalid(RuntimeException error) { return ResponseEntity.status(409).body(Map.of("success",false,"message",error.getMessage())); }
}
