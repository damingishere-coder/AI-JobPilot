package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.mapper.ProfileMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.TransactionDefinition;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProfileHrGuardTest {
    private final HrProfileGuard guard = new HrProfileGuard();
    private final ProfileMapper mapper = mock(ProfileMapper.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    private ProfileEntity profile(long id) {
        ProfileEntity value = new ProfileEntity();
        value.setId(id);
        value.setName("档案" + id);
        return value;
    }

    private ProfileService service(Runnable onCommit) {
        when(mapper.selectById(2L)).thenReturn(profile(2));
        when(mapper.selectOne(any(QueryWrapper.class))).thenReturn(profile(1));
        var transactions = new AbstractPlatformTransactionManager() {
            protected Object doGetTransaction() { return new Object(); }
            protected void doBegin(Object tx, TransactionDefinition definition) {}
            protected void doCommit(DefaultTransactionStatus status) { onCommit.run(); }
            protected void doRollback(DefaultTransactionStatus status) {}
        };
        return new ProfileService(mapper, jdbc, transactions, guard);
    }

    @Test
    void watchBlocksActivationAndDeletionOfCurrentProfileBeforeAnyWrites() {
        var service = service(() -> {});
        guard.registerBlocker(() -> true);
        assertThatThrownBy(() -> service.activateProfile(2L)).isInstanceOf(HrProfileGuard.WatchActiveException.class);
        assertThatThrownBy(() -> service.deleteProfile(1L, true)).isInstanceOf(HrProfileGuard.WatchActiveException.class);
        verifyNoInteractions(jdbc);
        verify(mapper, never()).updateById(any(ProfileEntity.class));
        guard.registerBlocker(() -> false);
        assertThat(service.activateProfile(2L).getId()).isEqualTo(2);
    }

    @Test
    void activationEndpointReturnsConflictWithStableErrorCode() throws Exception {
        var service = service(() -> {});
        guard.registerBlocker(() -> true);
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders
                .standaloneSetup(new com.getjobs.application.controller.ProfileController(service))
                .setControllerAdvice(new com.getjobs.application.controller.GlobalExceptionHandler()).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/profiles/2/activate"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isConflict())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.errorCode").value("HR_WATCH_ACTIVE"));
    }

    @Test
    void switchingKeepsGuardUntilTransactionCommitSoWatchCannotStartInBetween() throws Exception {
        var inCommit = new CountDownLatch(1);
        var allowCommit = new CountDownLatch(1);
        var admitted = new AtomicBoolean(false);
        var service = service(() -> {
            inCommit.countDown();
            try { assertThat(allowCommit.await(3, TimeUnit.SECONDS)).isTrue(); }
            catch (InterruptedException e) { throw new RuntimeException(e); }
        });
        try (var executor = Executors.newFixedThreadPool(2)) {
            var switching = executor.submit(() -> service.activateProfile(2L));
            assertThat(inCommit.await(3, TimeUnit.SECONDS)).isTrue();
            var starting = executor.submit(() -> guard.locked(() -> { admitted.set(true); return null; }));
            assertThat(admitted.get()).isFalse();
            allowCommit.countDown();
            switching.get(3, TimeUnit.SECONDS);
            starting.get(3, TimeUnit.SECONDS);
            assertThat(admitted.get()).isTrue();
        } finally { allowCommit.countDown(); }
    }
}
