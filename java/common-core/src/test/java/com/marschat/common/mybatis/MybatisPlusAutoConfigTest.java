package com.marschat.common.mybatis;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.apache.ibatis.reflection.MetaObject;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * MyBatis-Plus 公共配置装配语义测试：
 * 有 MyBatis-Plus classpath 即装配；自定义 Bean 存在时让位；填充行为正确。
 */
class MybatisPlusAutoConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(MybatisPlusAutoConfig.class));

    /** strictFill 依赖 TableInfo 注册（生产环境由 MapperScan 自动完成），单测手动注册一次 */
    @BeforeAll
    static void initTableInfo() {
        MybatisConfiguration configuration = new MybatisConfiguration();
        org.apache.ibatis.builder.MapperBuilderAssistant assistant =
                new org.apache.ibatis.builder.MapperBuilderAssistant(configuration, "");
        TableInfoHelper.initTableInfo(assistant, FillEntity.class);
    }

    @Test
    @DisplayName("自动装配分页插件 + MetaObjectHandler")
    void autoConfigured() {
        runner.run(context -> {
            assertThat(context).hasSingleBean(MybatisPlusInterceptor.class);
            assertThat(context).hasSingleBean(MetaObjectHandler.class);

            MybatisPlusInterceptor interceptor = context.getBean(MybatisPlusInterceptor.class);
            assertThat(interceptor.getInterceptors()).hasSize(1);
            assertThat(interceptor.getInterceptors().get(0)).isInstanceOf(PaginationInnerInterceptor.class);
        });
    }

    @Test
    @DisplayName("服务自带 MybatisPlusInterceptor 时不覆盖")
    void customInterceptorRespected() {
        MybatisPlusInterceptor custom = new MybatisPlusInterceptor();
        runner.withBean("customInterceptor", MybatisPlusInterceptor.class, () -> custom)
                .run(context -> assertThat(context.getBean(MybatisPlusInterceptor.class)).isSameAs(custom));
    }

    @Test
    @DisplayName("MetaObjectHandler：insert 填充 createdAt+updatedAt，update 只填 updatedAt")
    void fillBehavior() {
        FillEntity entity = new FillEntity();
        MetaObjectHandler[] holder = new MetaObjectHandler[1];
        runner.run(context -> holder[0] = context.getBean(MetaObjectHandler.class));
        MetaObjectHandler handler = holder[0];
        assertThat(handler).isNotNull();

        MybatisConfiguration configuration = new MybatisConfiguration();
        MetaObject metaObject = configuration.newMetaObject(entity);

        handler.insertFill(metaObject);
        assertThat(entity.getCreatedAt()).isNotNull();
        assertThat(entity.getUpdatedAt()).isNotNull();

        entity.setUpdatedAt(null);
        handler.updateFill(metaObject);
        assertThat(entity.getUpdatedAt()).isNotNull();
    }

    /** 与现网实体写法一致的填充实体 */
    public static class FillEntity {
        @TableId(type = IdType.AUTO)
        private Long id;

        @TableField(fill = FieldFill.INSERT)
        private LocalDateTime createdAt;

        @TableField(fill = FieldFill.INSERT_UPDATE)
        private LocalDateTime updatedAt;

        public Long getId() {
            return id;
        }

        public void setId(Long id) {
            this.id = id;
        }

        public LocalDateTime getCreatedAt() {
            return createdAt;
        }

        public void setCreatedAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
        }

        public LocalDateTime getUpdatedAt() {
            return updatedAt;
        }

        public void setUpdatedAt(LocalDateTime updatedAt) {
            this.updatedAt = updatedAt;
        }
    }
}
