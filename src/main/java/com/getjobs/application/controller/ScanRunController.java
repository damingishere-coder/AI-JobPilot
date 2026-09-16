package com.getjobs.application.controller;

import com.getjobs.application.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@RestController
@RequestMapping("/api/scan-runs")
@RequiredArgsConstructor
public class ScanRunController {
    private final ScanRunService scans;
    private final ProfileService profiles;
    private final LocalActionTokenService tokens;
    private void scope(String platform,long profileId,String runId) {
        scans.validate(platform,profileId,runId);
        if(!Objects.equals(profiles.getCurrentProfileIdOrNull(),profileId)) throw new ResponseStatusException(HttpStatus.CONFLICT,"PROFILE_CHANGED");
    }
    private void auth(String token) {
        if(!tokens.isValid(token)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"LOCAL_ACTION_TOKEN_REQUIRED");
    }
    @PostMapping
    public Object register(@RequestParam String platform,@RequestParam long profileId,@RequestBody Map<String,String> body,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        auth(token);String id=body.get("runId");scope(platform,profileId,id);return scans.register(platform,profileId,id);
    }
    @GetMapping
    public Object list(@RequestParam String platform,@RequestParam long profileId) {
        scope(platform,profileId,"list");return scans.list(platform,profileId);
    }
    @GetMapping("/{id}")
    public Object detail(@PathVariable String id,@RequestParam String platform,@RequestParam long profileId) {
        scope(platform,profileId,id);return scans.detail(platform,profileId,id);
    }
    @GetMapping("/{id}/events")
    public Object events(@PathVariable String id,@RequestParam String platform,@RequestParam long profileId,@RequestParam(defaultValue="0") long after) {
        scope(platform,profileId,id);return scans.events(platform,profileId,id,after);
    }
    @PostMapping("/{id}/sync")
    public Object sync(@PathVariable String id,@RequestParam String platform,@RequestParam long profileId,@RequestBody Map<String,Object> body,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        auth(token);scope(platform,profileId,id);return scans.sync(platform,profileId,id,body);
    }
    @PostMapping("/{id}/commands")
    public Object command(@PathVariable String id,@RequestParam String platform,@RequestParam long profileId,@RequestBody Map<String,String> body,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        auth(token);scope(platform,profileId,id);return scans.command(platform,profileId,id,body.get("kind"),body.get("id"));
    }
    @GetMapping("/{id}/diagnostics")
    public Object diagnostics(@PathVariable String id,@RequestParam String platform,@RequestParam long profileId) {
        scope(platform,profileId,id);
        List<Map<String,Object>> events=new ArrayList<>();long after=0;
        while(events.size()<10000) {
            var page=scans.events(platform,profileId,id,after);if(page.isEmpty()) break;
            events.addAll(page);after=((Number)page.getLast().get("id")).longValue();
        }
        return Map.of("schemaVersion",1,"run",scans.detail(platform,profileId,id),"events",events,"nextCursor",after,"truncated",events.size()>=10000);
    }
}
